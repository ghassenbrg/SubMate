import { snapshotFromManifest } from '../netflix/manifest-parser';
import { BRIDGE_NAMESPACE } from '../netflix/netflix-types';
import { ManifestCaptureState } from './manifest-capture-state';

(() => {
  const post = (data: unknown) => window.postMessage(data, window.location.origin);
  const captureState = new ManifestCaptureState();
  const manifests = new Map<string, NonNullable<ReturnType<typeof snapshotFromManifest>>>();

  const observe = (value: unknown) => {
    try {
      const snapshot = snapshotFromManifest(value);
      if (!snapshot) return;
      manifests.delete(snapshot.contentId);
      manifests.set(snapshot.contentId, snapshot);
      while (manifests.size > 8) {
        const oldest = manifests.keys().next().value;
        if (!oldest) break;
        manifests.delete(oldest);
      }
      const safeSnapshot = captureState.record(snapshot);
      if (!safeSnapshot) return;
      post({
        namespace: BRIDGE_NAMESPACE,
        type: 'manifest',
        snapshot: safeSnapshot,
      });
    } catch {
      // Netflix must never be disrupted by observation failures.
    }
  };

  const originalParse = JSON.parse;
  JSON.parse = function subMateJsonParse(text: string, reviver?: (this: unknown, key: string, value: unknown) => unknown) {
    const result = originalParse.call(JSON, text, reviver);
    observe(result);
    return result;
  };

  const originalResponseJson = Response.prototype.json;
  Response.prototype.json = async function subMateResponseJson() {
    const result = await originalResponseJson.call(this);
    observe(result);
    return result;
  };

  const notifyNavigation = () => {
    const match = /^\/watch\/(\d+)/.exec(location.pathname);
    const contentId = match?.[1];
    post({
      namespace: BRIDGE_NAMESPACE,
      type: 'navigation',
      ...(contentId ? { contentId } : {}),
    });
    const replay = contentId ? captureState.replay(contentId) : undefined;
    if (replay) post({ namespace: BRIDGE_NAMESPACE, type: 'manifest', snapshot: replay });
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
  addEventListener('message', (event) => {
    if (event.source !== window || event.origin !== location.origin) return;
    const data = event.data as Record<string, unknown> | null;
    if (!data || data.namespace !== BRIDGE_NAMESPACE) return;
    if (data.type === 'manifest-replay-request') {
      const contentId = /^\/watch\/(\d+)/.exec(location.pathname)?.[1];
      const replay = contentId ? captureState.replay(contentId) : undefined;
      if (replay) post({ namespace: BRIDGE_NAMESPACE, type: 'manifest', snapshot: replay });
      return;
    }
    if (data.type !== 'subtitle-request') return;
    const requestId = typeof data.requestId === 'string' && /^[a-f0-9-]{20,80}$/i.test(data.requestId) ? data.requestId : undefined;
    const contentId = typeof data.contentId === 'string' ? data.contentId : undefined;
    const trackId = typeof data.trackId === 'string' ? data.trackId : undefined;
    const profile = typeof data.profile === 'string' ? data.profile : undefined;
    const pathId = /^\/watch\/(\d+)/.exec(location.pathname)?.[1];
    if (!requestId || !contentId || contentId !== pathId || !trackId || !profile) return;
    const download = manifests.get(contentId)?.tracks
      .find((track) => track.trackId === trackId)?.downloads
      .find((item) => item.profile === profile && item.kind === 'text');
    if (!download) {
      post({ namespace: BRIDGE_NAMESPACE, type: 'subtitle-response', requestId, ok: false, error: 'Captured subtitle track is unavailable' });
      return;
    }
    void (async () => {
      let cause = 'Subtitle download failed';
      for (const url of download.urls) {
        try {
          const response = await fetch(url, { method: 'GET', credentials: 'omit', referrerPolicy: 'no-referrer' });
          if (!response.ok) throw new Error(`HTTP ${response.status}`);
          const length = Number(response.headers.get('content-length'));
          if (Number.isFinite(length) && length > 10_000_000) throw new Error('Subtitle exceeds size limit');
          const text = await response.text();
          if (text.length > 10_000_000) throw new Error('Subtitle exceeds size limit');
          post({ namespace: BRIDGE_NAMESPACE, type: 'subtitle-response', requestId, ok: true, text, contentType: response.headers.get('content-type') ?? '' });
          return;
        } catch (error) {
          cause = error instanceof Error ? error.message.slice(0, 200) : cause;
        }
      }
      post({ namespace: BRIDGE_NAMESPACE, type: 'subtitle-response', requestId, ok: false, error: cause });
    })();
  });
  notifyNavigation();
})();
