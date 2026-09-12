import { routeContentId } from '../platforms/prime/prime-detection';
import {
  scanForSubtitles,
  snapshotFromPlaybackResources,
  type PrimePlaybackSnapshot,
} from '../platforms/prime/prime-manifest';
import { PRIME_BRIDGE_NAMESPACE, PRIME_LIMITS } from '../platforms/prime/prime-types';

/**
 * MAIN-world agent for Prime Video.
 *
 * Amazon resolves playback through its own service and hands the player a
 * payload that includes sidecar subtitle documents. This agent observes that
 * payload, retains the URLs inside the page realm, and downloads a document
 * only when the extension asks for one by language.
 *
 * Nothing here touches DRM: sidecar timed text is delivered separately from the
 * protected stream, and no licence, key or media request is involved.
 */
(() => {
  const post = (data: unknown) => window.postMessage(data, window.location.origin);

  /** Snapshots keep their URLs; only stripped copies are published. */
  const snapshots = new Map<string, PrimePlaybackSnapshot>();
  const published = new Map<string, string>();
  const MAX_TITLES = 8;

  const publicSnapshot = (snapshot: PrimePlaybackSnapshot): PrimePlaybackSnapshot => ({
    ...snapshot,
    subtitles: snapshot.subtitles.map((track) => ({ ...track, url: '' })),
  });

  const signature = (snapshot: PrimePlaybackSnapshot): string =>
    JSON.stringify(snapshot.subtitles.map((track) => [track.language, track.forced, track.label, track.url]));

  /** Hostnames already reported, so one rejected CDN is not logged forever. */
  const reportedHosts = new Set<string>();

  const observe = (value: unknown) => {
    try {
      const route = routeContentId();
      const snapshot = snapshotFromPlaybackResources(value, route);
      if (!snapshot) {
        // A payload that clearly described subtitles but produced nothing is
        // the single most useful thing to surface: it means the URL policy or
        // the key spellings need widening, not that captions are absent.
        const scan = scanForSubtitles(value);
        for (const host of scan.rejectedHosts) {
          if (reportedHosts.has(host)) continue;
          reportedHosts.add(host);
          post({
            namespace: PRIME_BRIDGE_NAMESPACE,
            type: 'diagnostic',
            reason: 'subtitle-host-rejected',
            detail: host,
          });
        }
        return;
      }
      snapshots.delete(snapshot.contentId);
      snapshots.set(snapshot.contentId, snapshot);
      while (snapshots.size > MAX_TITLES) {
        const oldest = snapshots.keys().next().value as string | undefined;
        if (!oldest) break;
        snapshots.delete(oldest);
        published.delete(oldest);
      }
      const next = signature(snapshot);
      if (published.get(snapshot.contentId) === next) return;
      published.set(snapshot.contentId, next);
      // Prime resolves playback for recommendations and next-episode preloads,
      // so a payload for a different title is skipped. The check applies only
      // when the route actually names a title: comparing against `undefined`
      // would otherwise discard every payload on an unrecognised route shape.
      if (route && snapshot.contentId !== route && !snapshot.contentId.startsWith('derived-')) return;
      post({ namespace: PRIME_BRIDGE_NAMESPACE, type: 'playback', snapshot: publicSnapshot(snapshot) });
    } catch {
      // Prime Video must never be disrupted by observation failures.
    }
  };

  const originalParse = JSON.parse;
  JSON.parse = function flixTranslateJsonParse(text: string, reviver?: (this: unknown, key: string, value: unknown) => unknown) {
    const result = originalParse.call(JSON, text, reviver);
    observe(result);
    return result;
  };

  const originalResponseJson = Response.prototype.json;
  Response.prototype.json = async function flixTranslateResponseJson() {
    const result = await originalResponseJson.call(this);
    observe(result);
    return result;
  };

  const replay = () => {
    const contentId = routeContentId();
    const snapshot = contentId ? snapshots.get(contentId) : undefined;
    if (snapshot) post({ namespace: PRIME_BRIDGE_NAMESPACE, type: 'playback', snapshot: publicSnapshot(snapshot) });
  };

  const notifyNavigation = () => {
    const contentId = routeContentId();
    post({
      namespace: PRIME_BRIDGE_NAMESPACE,
      type: 'navigation',
      ...(contentId ? { contentId } : {}),
    });
    replay();
  };

  for (const method of ['pushState', 'replaceState'] as const) {
    const original = history[method];
    history[method] = function flixTranslateHistory(this: History, ...args: Parameters<History[typeof method]>) {
      const result = original.apply(this, args);
      queueMicrotask(notifyNavigation);
      return result;
    } as History[typeof method];
  }
  addEventListener('popstate', notifyNavigation);

  addEventListener('message', (event) => {
    if (event.source !== window || event.origin !== location.origin) return;
    const data = event.data as Record<string, unknown> | null;
    if (!data || data.namespace !== PRIME_BRIDGE_NAMESPACE) return;
    if (data.type === 'playback-replay-request') {
      replay();
      return;
    }
    if (data.type !== 'subtitle-request') return;
    const requestId = typeof data.requestId === 'string' && /^[a-f0-9-]{20,80}$/i.test(data.requestId)
      ? data.requestId
      : undefined;
    const contentId = typeof data.contentId === 'string' ? data.contentId : undefined;
    const language = typeof data.language === 'string' ? data.language : undefined;
    const forced = data.forced === true;
    // A request may only name the title currently on screen.
    const routeId = routeContentId();
    if (!requestId || !contentId || !language) return;
    // Same reasoning as above: only enforce the route match when there is one.
    if (routeId && contentId !== routeId && !contentId.startsWith('derived-')) return;

    const track = snapshots.get(contentId)?.subtitles
      .find((item) => item.language === language && item.forced === forced);
    if (!track?.url) {
      post({
        namespace: PRIME_BRIDGE_NAMESPACE, type: 'subtitle-response', requestId,
        ok: false, error: 'Captured subtitle track is unavailable',
      });
      return;
    }

    void (async () => {
      try {
        // Credentials are omitted so no Amazon cookie accompanies the download;
        // sidecar subtitle URLs are already authorized by their own signature.
        const response = await fetch(track.url, {
          method: 'GET',
          credentials: 'omit',
          referrerPolicy: 'no-referrer',
        });
        if (!response.ok) throw new Error(`HTTP ${response.status}`);
        const declared = Number(response.headers.get('content-length'));
        if (Number.isFinite(declared) && declared > PRIME_LIMITS.maxSubtitleBytes) {
          throw new Error('Subtitle exceeds size limit');
        }
        const text = await response.text();
        if (text.length > PRIME_LIMITS.maxSubtitleBytes) throw new Error('Subtitle exceeds size limit');
        post({
          namespace: PRIME_BRIDGE_NAMESPACE, type: 'subtitle-response', requestId, ok: true,
          text, contentType: response.headers.get('content-type') ?? '',
        });
      } catch (error) {
        // Scrubbed so a signed URL cannot escape through an error string.
        const raw = error instanceof Error ? error.message : 'Subtitle download failed';
        post({
          namespace: PRIME_BRIDGE_NAMESPACE, type: 'subtitle-response', requestId, ok: false,
          error: raw.replaceAll(/\b(?:https?:\/\/|\/\/)\S*/gi, '[url]').slice(0, 200),
        });
      }
    })();
  });

  notifyNavigation();
})();
