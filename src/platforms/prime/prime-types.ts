import type { PrimePlaybackSnapshot } from './prime-manifest';

export const PRIME_BRIDGE_NAMESPACE = 'flixtranslate:prime-playback:v1';

/**
 * Messages between the page realm and the extension realm.
 *
 * Subtitle URLs stay in the page realm, exactly as for Netflix and TVer: the
 * snapshot that crosses over is stripped of them, and only decoded timed-text
 * comes back.
 */
export type PrimeBridgeMessage =
  | { namespace: typeof PRIME_BRIDGE_NAMESPACE; type: 'playback'; snapshot: PrimePlaybackSnapshot }
  | { namespace: typeof PRIME_BRIDGE_NAMESPACE; type: 'playback-replay-request' }
  | { namespace: typeof PRIME_BRIDGE_NAMESPACE; type: 'navigation'; contentId?: string }
  /** Explains a discovery miss. Carries hostnames only, never a full URL. */
  | { namespace: typeof PRIME_BRIDGE_NAMESPACE; type: 'diagnostic'; reason: string; detail?: string }
  | {
      namespace: typeof PRIME_BRIDGE_NAMESPACE;
      type: 'subtitle-request';
      requestId: string;
      contentId: string;
      language: string;
      forced: boolean;
    }
  | {
      namespace: typeof PRIME_BRIDGE_NAMESPACE;
      type: 'subtitle-response';
      requestId: string;
      ok: true;
      text: string;
      contentType: string;
    }
  | {
      namespace: typeof PRIME_BRIDGE_NAMESPACE;
      type: 'subtitle-response';
      requestId: string;
      ok: false;
      error: string;
    };

export const PRIME_LIMITS = {
  maxSubtitleBytes: 10_000_000,
} as const;
