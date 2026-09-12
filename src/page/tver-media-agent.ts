import { isMasterManifest, parseMasterManifest, parseMediaPlaylist } from '../core/hls/manifest';
import { isJapanese } from '../core/subtitles/language';
import { withRetry } from '../core/retry';
import {
  TVER_BRIDGE_NAMESPACE,
  TVER_LIMITS,
  type TVerSubtitleErrorCode,
  type TVerSubtitleSegment,
  type TVerSubtitleTrackInfo,
} from '../platforms/tver/tver-types';

/**
 * MAIN-world agent for TVer.
 *
 * It observes which media manifests the authorized player loads and, on demand,
 * walks the HLS subtitle playlist using the page's own credentials. Only decoded
 * WebVTT text crosses back into the extension world — never a signed URL.
 *
 * Every browser API it wraps is wrapped non-destructively: the original is
 * always invoked with the original arguments, its return value is passed
 * through untouched, and observation failures are swallowed so that TVer
 * playback can never be broken by this extension.
 */
(() => {
  const post = (data: unknown) => window.postMessage(data, window.location.origin);

  /** Recently observed manifest URLs, newest last, bounded. */
  const manifestUrls: string[] = [];
  const MAX_TRACKED = 12;

  const looksLikeManifest = (value: string): boolean => {
    try {
      const url = new URL(value, location.href);
      if (url.protocol !== 'https:' && url.protocol !== 'http:') return false;
      return /\.m3u8(?:$|[?#])/i.test(url.pathname + url.search);
    } catch {
      return false;
    }
  };

  const remember = (value: string) => {
    try {
      if (!looksLikeManifest(value)) return;
      const absolute = new URL(value, location.href).toString();
      const existing = manifestUrls.indexOf(absolute);
      if (existing >= 0) manifestUrls.splice(existing, 1);
      manifestUrls.push(absolute);
      while (manifestUrls.length > MAX_TRACKED) manifestUrls.shift();
      // The count alone tells the extension world that discovery is possible.
      post({ namespace: TVER_BRIDGE_NAMESPACE, type: 'manifest-observed', manifestCount: manifestUrls.length });
    } catch {
      // Observation must never interrupt the page.
    }
  };

  // --- Non-destructive network observation -------------------------------

  const originalFetch = window.fetch;
  const patchedFetch: typeof window.fetch = function subMateFetch(this: unknown, ...args) {
    try {
      const input = args[0];
      const url = typeof input === 'string' ? input
        : input instanceof URL ? input.toString()
        : input instanceof Request ? input.url
        : undefined;
      if (url) remember(url);
    } catch {
      // Never let observation change fetch semantics.
    }
    return originalFetch.apply(this as never, args as never);
  };
  window.fetch = patchedFetch;

  const originalOpen = XMLHttpRequest.prototype.open;
  const patchedOpen = function subMateXhrOpen(
    this: XMLHttpRequest,
    ...args: Parameters<typeof XMLHttpRequest.prototype.open>
  ) {
    try {
      const url = args[1];
      if (typeof url === 'string') remember(url);
      else if (url instanceof URL) remember(url.toString());
    } catch {
      // Ignore.
    }
    return originalOpen.apply(this, args);
  } as typeof XMLHttpRequest.prototype.open;
  XMLHttpRequest.prototype.open = patchedOpen;

  // Resource Timing catches manifests requested before the wrappers installed,
  // and requests issued by workers or media elements that bypass fetch/XHR.
  let performanceObserver: PerformanceObserver | undefined;
  try {
    performanceObserver = new PerformanceObserver((list) => {
      for (const entry of list.getEntries()) remember(entry.name);
    });
    performanceObserver.observe({ type: 'resource', buffered: true });
  } catch {
    // Resource Timing is optional.
  }

  /** Restores every wrapped API, but only if nothing else re-wrapped it since. */
  const restore = () => {
    try {
      if (window.fetch === patchedFetch) window.fetch = originalFetch;
      if (XMLHttpRequest.prototype.open === patchedOpen) XMLHttpRequest.prototype.open = originalOpen;
      performanceObserver?.disconnect();
    } catch {
      // Ignore teardown races.
    }
  };
  addEventListener('pagehide', restore, { once: true });

  // --- Subtitle resolution ------------------------------------------------

  class AgentError extends Error {
    constructor(readonly code: TVerSubtitleErrorCode, message: string) {
      super(message);
    }
  }

  /**
   * Strips anything URL-shaped from a message before it leaves the page realm.
   * Media URLs are signed and must never reach logs or the extension world,
   * even incidentally through a network error string.
   */
  const safeMessage = (error: unknown): string => {
    const raw = error instanceof Error ? error.message : 'Subtitle discovery failed';
    return raw.replaceAll(/\b(?:https?:\/\/|\/\/)\S*/gi, '[url]').slice(0, 200);
  };

  const fetchText = async (url: string, maxBytes: number, signal?: AbortSignal): Promise<string> => {
    // `same-origin` credentials keep the player's own authorization behaviour
    // without this extension ever reading or forwarding those credentials.
    const response = await originalFetch(url, {
      method: 'GET',
      credentials: 'same-origin',
      signal: signal ?? null,
    });
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    const declared = Number(response.headers.get('content-length'));
    if (Number.isFinite(declared) && declared > maxBytes) throw new Error('Resource exceeds size limit');
    const text = await response.text();
    if (text.length > maxBytes) throw new Error('Resource exceeds size limit');
    return text;
  };

  /** Finds the newest observed URL that actually parses as a master playlist. */
  const resolveMaster = async (signal: AbortSignal): Promise<{ url: string; text: string }> => {
    if (!manifestUrls.length) throw new AgentError('NO_MANIFEST', 'No media manifest observed yet');
    for (const url of [...manifestUrls].reverse()) {
      if (signal.aborted) throw new DOMException('Aborted', 'AbortError');
      try {
        const text = await fetchText(url, TVER_LIMITS.maxManifestBytes, signal);
        if (isMasterManifest(text)) return { url, text };
      } catch (error) {
        if (error instanceof DOMException && error.name === 'AbortError') throw error;
        // Signed URLs expire; try the next candidate rather than failing.
      }
    }
    throw new AgentError('NO_MANIFEST', 'No reachable master manifest among observed URLs');
  };

  const pickJapaneseTrack = (masterText: string, masterUrl: string) => {
    const subtitleTracks = parseMasterManifest(masterText, masterUrl)
      .filter((track) => track.type === 'SUBTITLES' && track.uri);
    const japanese = subtitleTracks.filter((track) => isJapanese(track.language));
    const candidates = japanese.length ? japanese : [];
    if (!candidates.length) {
      throw new AgentError('NO_JAPANESE_SUBTITLE_TRACK', 'Master manifest exposes no Japanese subtitle track');
    }
    // Prefer a full track marked default/autoselect over a forced-narrative one.
    const ranked = [...candidates].sort((a, b) => {
      const score = (track: typeof a) =>
        (track.forced ? 4 : 0) + (track.isDefault ? -2 : 0) + (track.autoselect ? -1 : 0);
      return score(a) - score(b);
    });
    return ranked[0] as NonNullable<(typeof ranked)[0]>;
  };

  const loadSegments = async (
    playlistUrl: string,
    signal: AbortSignal,
  ): Promise<{ segments: TVerSubtitleSegment[]; failed: number }> => {
    const playlistText = await withRetry(
      () => fetchText(playlistUrl, TVER_LIMITS.maxManifestBytes, signal),
      { signal },
    ).catch(() => {
      throw new AgentError('SUBTITLE_MANIFEST_FAILED', 'Subtitle media playlist could not be loaded');
    });
    const playlist = parseMediaPlaylist(playlistText, playlistUrl);
    if (!playlist.segments.length) {
      throw new AgentError('SUBTITLE_MANIFEST_FAILED', 'Subtitle playlist contains no segments');
    }
    const wanted = playlist.segments.slice(0, TVER_LIMITS.maxSegments);
    const segments: TVerSubtitleSegment[] = [];
    let failed = 0;
    let totalBytes = 0;

    // Segments are tiny; a small concurrency window keeps extraction fast
    // without behaving like a crawler against the CDN.
    const CONCURRENCY = 6;
    let cursor = 0;
    const workers = Array.from({ length: Math.min(CONCURRENCY, wanted.length) }, async () => {
      for (;;) {
        if (signal.aborted) throw new DOMException('Aborted', 'AbortError');
        const index = cursor++;
        const segment = wanted[index];
        if (!segment) return;
        try {
          const text = await withRetry(
            () => fetchText(segment.uri, TVER_LIMITS.maxSegmentBytes, signal),
            { signal },
          );
          totalBytes += text.length;
          if (totalBytes > TVER_LIMITS.maxTotalBytes) throw new Error('Subtitle track exceeds size limit');
          segments.push({ text, startMs: segment.startMs });
        } catch (error) {
          if (error instanceof DOMException && error.name === 'AbortError') throw error;
          // A single missing segment must not discard the whole episode track.
          failed += 1;
        }
      }
    });
    await Promise.all(workers);
    if (!segments.length) {
      throw new AgentError('SUBTITLE_SEGMENT_FAILED', 'Every subtitle segment failed to load');
    }
    segments.sort((a, b) => a.startMs - b.startMs);
    return { segments, failed };
  };

  addEventListener('message', (event) => {
    if (event.source !== window || event.origin !== location.origin) return;
    const data = event.data as Record<string, unknown> | null;
    if (!data || data.namespace !== TVER_BRIDGE_NAMESPACE || data.type !== 'subtitle-request') return;
    const requestId = typeof data.requestId === 'string' && /^[a-f0-9-]{20,80}$/i.test(data.requestId)
      ? data.requestId
      : undefined;
    if (!requestId) return;

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(new DOMException('Timed out', 'AbortError')), 120_000);
    void (async () => {
      try {
        const master = await resolveMaster(controller.signal);
        const track = pickJapaneseTrack(master.text, master.url);
        const { segments, failed } = await loadSegments(track.uri as string, controller.signal);
        const info: TVerSubtitleTrackInfo = {
          language: track.language ?? 'ja',
          ...(track.name ? { name: track.name } : {}),
          isDefault: track.isDefault,
          forced: track.forced,
        };
        post({
          namespace: TVER_BRIDGE_NAMESPACE,
          type: 'subtitle-response',
          requestId,
          ok: true,
          track: info,
          segments,
          failedSegments: failed,
        });
      } catch (error) {
        const code: TVerSubtitleErrorCode = error instanceof AgentError ? error.code : 'SUBTITLE_MANIFEST_FAILED';
        post({
          namespace: TVER_BRIDGE_NAMESPACE,
          type: 'subtitle-response',
          requestId,
          ok: false,
          error: safeMessage(error),
          code,
        });
      } finally {
        clearTimeout(timeout);
      }
    })();
  });

  // --- SPA navigation ------------------------------------------------------

  const episodeId = (): string | undefined =>
    /^\/episodes\/([A-Za-z0-9_-]{1,64})/.exec(location.pathname)?.[1];

  const notifyNavigation = () => {
    const contentId = episodeId();
    // A new episode invalidates every previously observed manifest.
    manifestUrls.length = 0;
    post({
      namespace: TVER_BRIDGE_NAMESPACE,
      type: 'navigation',
      ...(contentId ? { contentId } : {}),
    });
  };

  for (const method of ['pushState', 'replaceState'] as const) {
    const original = history[method];
    history[method] = function subMateHistory(this: History, ...args: Parameters<History[typeof method]>) {
      const result = original.apply(this, args);
      queueMicrotask(notifyNavigation);
      return result;
    } as History[typeof method];
  }
  addEventListener('popstate', notifyNavigation);
  notifyNavigation();
})();
