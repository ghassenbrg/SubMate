import { isManifestSnapshot } from '../netflix/manifest-parser';
import { BRIDGE_NAMESPACE, type NetflixManifestSnapshot } from '../netflix/netflix-types';
import { FlixTranslateError } from '../shared-errors';

export interface NetflixBridgeHandlers {
  onManifest(snapshot: NetflixManifestSnapshot): void;
  onNavigation(contentId?: string): void;
}

export interface PageSubtitleResponse { text: string; contentType: string }

export function requestPageSubtitle(
  contentId: string,
  trackId: string,
  profile: string,
  signal?: AbortSignal,
): Promise<PageSubtitleResponse> {
  const requestId = crypto.randomUUID();
  return new Promise((resolve, reject) => {
    const cleanup = () => {
      window.removeEventListener('message', listener);
      signal?.removeEventListener('abort', onAbort);
      clearTimeout(timeout);
    };
    const onAbort = () => { cleanup(); reject(signal?.reason ?? new DOMException('Aborted', 'AbortError')); };
    const listener = (event: MessageEvent) => {
      if (event.source !== window || event.origin !== location.origin) return;
      const data = event.data as Record<string, unknown> | null;
      if (!data || data.namespace !== BRIDGE_NAMESPACE || data.type !== 'subtitle-response' || data.requestId !== requestId) return;
      cleanup();
      if (data.ok !== true) {
        reject(new FlixTranslateError('SUBTITLE_DOWNLOAD_FAILED', typeof data.error === 'string' ? data.error.slice(0, 200) : 'Subtitle download failed'));
        return;
      }
      if (typeof data.text !== 'string' || data.text.length > 10_000_000 || typeof data.contentType !== 'string' || data.contentType.length > 200) {
        reject(new FlixTranslateError('SUBTITLE_DOWNLOAD_FAILED', 'Malformed subtitle response'));
        return;
      }
      resolve({ text: data.text, contentType: data.contentType });
    };
    const timeout = window.setTimeout(() => {
      cleanup();
      reject(new FlixTranslateError('SUBTITLE_DOWNLOAD_FAILED', 'Subtitle download timed out'));
    }, 30_000);
    window.addEventListener('message', listener);
    signal?.addEventListener('abort', onAbort, { once: true });
    window.postMessage({ namespace: BRIDGE_NAMESPACE, type: 'subtitle-request', requestId, contentId, trackId, profile }, location.origin);
  });
}

export function startNetflixBridge(handlers: NetflixBridgeHandlers): () => void {
  const listener = (event: MessageEvent) => {
    if (event.source !== window || event.origin !== window.location.origin) return;
    const data = event.data as Record<string, unknown> | null;
    if (!data || data.namespace !== BRIDGE_NAMESPACE) return;
    if (data.type === 'manifest' && isManifestSnapshot(data.snapshot)) {
      handlers.onManifest(data.snapshot);
      return;
    }
    if (data.type === 'navigation') {
      const contentId = typeof data.contentId === 'string' && /^\d{1,30}$/.test(data.contentId)
        ? data.contentId
        : undefined;
      handlers.onNavigation(contentId);
    }
  };
  window.addEventListener('message', listener);
  return () => window.removeEventListener('message', listener);
}
