import { SubMateError } from '../../shared-errors';
import {
  TVER_BRIDGE_NAMESPACE,
  TVER_LIMITS,
  type TVerSubtitleSegment,
  type TVerSubtitleTrackInfo,
} from './tver-types';

export interface TVerBridgeHandlers {
  onManifestObserved(count: number): void;
  onNavigation(contentId?: string): void;
}

export interface TVerSubtitlePayload {
  track: TVerSubtitleTrackInfo;
  segments: TVerSubtitleSegment[];
  failedSegments: number;
}

const ERROR_CODES = {
  NO_MANIFEST: 'NO_MANIFEST',
  SUBTITLE_MANIFEST_FAILED: 'SUBTITLE_MANIFEST_FAILED',
  NO_JAPANESE_SUBTITLE_TRACK: 'NO_TEXT_SUBTITLE_TRACK',
  SUBTITLE_SEGMENT_FAILED: 'SUBTITLE_SEGMENT_FAILED',
} as const;

/** Validates an untrusted page-world payload before it reaches core logic. */
function readPayload(data: Record<string, unknown>): TVerSubtitlePayload | undefined {
  const rawTrack = data.track as Record<string, unknown> | undefined;
  if (!rawTrack || typeof rawTrack.language !== 'string' || rawTrack.language.length > 35) return undefined;
  if (!Array.isArray(data.segments) || data.segments.length > TVER_LIMITS.maxSegments) return undefined;
  const segments: TVerSubtitleSegment[] = [];
  let totalBytes = 0;
  for (const raw of data.segments) {
    const segment = raw as Record<string, unknown> | null;
    if (!segment || typeof segment.text !== 'string' || typeof segment.startMs !== 'number') return undefined;
    if (segment.text.length > TVER_LIMITS.maxSegmentBytes || !Number.isFinite(segment.startMs)) return undefined;
    totalBytes += segment.text.length;
    if (totalBytes > TVER_LIMITS.maxTotalBytes) return undefined;
    segments.push({ text: segment.text, startMs: segment.startMs });
  }
  return {
    track: {
      language: rawTrack.language,
      ...(typeof rawTrack.name === 'string' && rawTrack.name.length <= 160 ? { name: rawTrack.name } : {}),
      isDefault: rawTrack.isDefault === true,
      forced: rawTrack.forced === true,
    },
    segments,
    failedSegments: typeof data.failedSegments === 'number' && Number.isFinite(data.failedSegments)
      ? data.failedSegments
      : 0,
  };
}

/**
 * Asks the page-world agent to walk the HLS subtitle playlist and return the
 * decoded WebVTT segments. No media URL ever crosses this boundary.
 */
export function requestTVerSubtitles(
  preferredLanguage: string,
  signal?: AbortSignal,
): Promise<TVerSubtitlePayload> {
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
      if (!data || data.namespace !== TVER_BRIDGE_NAMESPACE) return;
      if (data.type !== 'subtitle-response' || data.requestId !== requestId) return;
      cleanup();
      if (data.ok !== true) {
        const rawCode = String(data.code ?? '') as keyof typeof ERROR_CODES;
        const code = ERROR_CODES[rawCode] ?? 'SUBTITLE_DOWNLOAD_FAILED';
        reject(new SubMateError(code, typeof data.error === 'string' ? data.error.slice(0, 200) : 'TVer subtitle discovery failed'));
        return;
      }
      const payload = readPayload(data);
      if (!payload) {
        reject(new SubMateError('SUBTITLE_DOWNLOAD_FAILED', 'Malformed TVer subtitle response'));
        return;
      }
      resolve(payload);
    };
    const timeout = window.setTimeout(() => {
      cleanup();
      reject(new SubMateError('SUBTITLE_DOWNLOAD_FAILED', 'TVer subtitle discovery timed out'));
    }, 130_000);
    window.addEventListener('message', listener);
    signal?.addEventListener('abort', onAbort, { once: true });
    window.postMessage(
      { namespace: TVER_BRIDGE_NAMESPACE, type: 'subtitle-request', requestId, preferredLanguage },
      location.origin,
    );
  });
}

export function startTVerBridge(handlers: TVerBridgeHandlers): () => void {
  const listener = (event: MessageEvent) => {
    if (event.source !== window || event.origin !== location.origin) return;
    const data = event.data as Record<string, unknown> | null;
    if (!data || data.namespace !== TVER_BRIDGE_NAMESPACE) return;
    if (data.type === 'manifest-observed') {
      const count = typeof data.manifestCount === 'number' ? data.manifestCount : 0;
      handlers.onManifestObserved(count);
      return;
    }
    if (data.type === 'navigation') {
      const contentId = typeof data.contentId === 'string' && /^[A-Za-z0-9_-]{1,64}$/.test(data.contentId)
        ? data.contentId
        : undefined;
      handlers.onNavigation(contentId);
    }
  };
  window.addEventListener('message', listener);
  return () => window.removeEventListener('message', listener);
}
