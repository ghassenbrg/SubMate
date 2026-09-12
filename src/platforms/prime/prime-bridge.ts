import { FlixTranslateError } from '../../shared-errors';
import { isPrimeSnapshot, type PrimePlaybackSnapshot } from './prime-manifest';
import { PRIME_BRIDGE_NAMESPACE, PRIME_LIMITS } from './prime-types';

export interface PrimeBridgeHandlers {
  onPlayback(snapshot: PrimePlaybackSnapshot): void;
  onNavigation(contentId?: string): void;
  /** Explains a discovery miss; carries hostnames only, never a full URL. */
  onDiagnostic?(reason: string, detail?: string): void;
}

export interface PrimeSubtitleResponse {
  text: string;
  contentType: string;
}

/**
 * Asks the page realm to download a subtitle document it already holds a URL
 * for. The track is addressed by language rather than by URL, so no signed
 * address ever crosses into the extension realm in either direction.
 */
export function requestPrimeSubtitle(
  contentId: string,
  language: string,
  forced: boolean,
  signal?: AbortSignal,
): Promise<PrimeSubtitleResponse> {
  const requestId = crypto.randomUUID();
  return new Promise((resolve, reject) => {
    const cleanup = () => {
      window.removeEventListener('message', listener);
      signal?.removeEventListener('abort', onAbort);
      clearTimeout(timeout);
    };
    const onAbort = () => {
      cleanup();
      reject(signal?.reason ?? new DOMException('Aborted', 'AbortError'));
    };
    const listener = (event: MessageEvent) => {
      if (event.source !== window || event.origin !== location.origin) return;
      const data = event.data as Record<string, unknown> | null;
      if (!data || data.namespace !== PRIME_BRIDGE_NAMESPACE) return;
      if (data.type !== 'subtitle-response' || data.requestId !== requestId) return;
      cleanup();
      if (data.ok !== true) {
        reject(new FlixTranslateError(
          'SUBTITLE_DOWNLOAD_FAILED',
          typeof data.error === 'string' ? data.error.slice(0, 200) : 'Subtitle download failed',
        ));
        return;
      }
      if (
        typeof data.text !== 'string' ||
        data.text.length > PRIME_LIMITS.maxSubtitleBytes ||
        typeof data.contentType !== 'string' ||
        data.contentType.length > 200
      ) {
        reject(new FlixTranslateError('SUBTITLE_DOWNLOAD_FAILED', 'Malformed subtitle response'));
        return;
      }
      resolve({ text: data.text, contentType: data.contentType });
    };
    const timeout = window.setTimeout(() => {
      cleanup();
      reject(new FlixTranslateError('SUBTITLE_DOWNLOAD_FAILED', 'Subtitle download timed out'));
    }, 45_000);
    window.addEventListener('message', listener);
    signal?.addEventListener('abort', onAbort, { once: true });
    window.postMessage(
      { namespace: PRIME_BRIDGE_NAMESPACE, type: 'subtitle-request', requestId, contentId, language, forced },
      location.origin,
    );
  });
}

export function startPrimeBridge(handlers: PrimeBridgeHandlers): () => void {
  const listener = (event: MessageEvent) => {
    if (event.source !== window || event.origin !== location.origin) return;
    const data = event.data as Record<string, unknown> | null;
    if (!data || data.namespace !== PRIME_BRIDGE_NAMESPACE) return;
    if (data.type === 'playback' && isPrimeSnapshot(data.snapshot)) {
      handlers.onPlayback(data.snapshot);
      return;
    }
    if (data.type === 'diagnostic') {
      const reason = typeof data.reason === 'string' ? data.reason.slice(0, 80) : 'unknown';
      const detail = typeof data.detail === 'string' ? data.detail.slice(0, 200) : undefined;
      handlers.onDiagnostic?.(reason, detail);
      return;
    }
    if (data.type === 'navigation') {
      const contentId = typeof data.contentId === 'string' && /^[A-Za-z0-9._-]{6,64}$/.test(data.contentId)
        ? data.contentId
        : undefined;
      handlers.onNavigation(contentId);
    }
  };
  window.addEventListener('message', listener);
  // The MAIN-world agent starts at document_start while this bridge waits for
  // settings and UI setup. Prime can resolve playback during that gap, so ask
  // for the retained snapshot once the listener is ready.
  window.postMessage({ namespace: PRIME_BRIDGE_NAMESPACE, type: 'playback-replay-request' }, location.origin);
  return () => window.removeEventListener('message', listener);
}
