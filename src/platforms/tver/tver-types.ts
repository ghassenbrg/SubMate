export const TVER_BRIDGE_NAMESPACE = 'flixtranslate:tver-media:v1';

/**
 * One WebVTT segment handed from the page world to the extension world.
 *
 * Only the decoded subtitle text and its playlist offset cross the boundary.
 * Signed media URLs, cookies and authorization headers deliberately stay inside
 * the page realm where the authorized player already holds them.
 */
export interface TVerSubtitleSegment {
  text: string;
  /** Segment start offset within the subtitle playlist, in milliseconds. */
  startMs: number;
}

export interface TVerSubtitleTrackInfo {
  language: string;
  name?: string;
  isDefault: boolean;
  forced: boolean;
}

export type TVerBridgeMessage =
  /** The page observed a media manifest; no URL is included by design. */
  | { namespace: typeof TVER_BRIDGE_NAMESPACE; type: 'manifest-observed'; manifestCount: number }
  | { namespace: typeof TVER_BRIDGE_NAMESPACE; type: 'subtitle-request'; requestId: string; preferredLanguage: string }
  | {
      namespace: typeof TVER_BRIDGE_NAMESPACE;
      type: 'subtitle-response';
      requestId: string;
      ok: true;
      track: TVerSubtitleTrackInfo;
      segments: TVerSubtitleSegment[];
      /** Segments that failed after retries; a partial track is still usable. */
      failedSegments: number;
    }
  | {
      namespace: typeof TVER_BRIDGE_NAMESPACE;
      type: 'subtitle-response';
      requestId: string;
      ok: false;
      error: string;
      code: TVerSubtitleErrorCode;
    }
  | { namespace: typeof TVER_BRIDGE_NAMESPACE; type: 'navigation'; contentId?: string };

export type TVerSubtitleErrorCode =
  | 'NO_MANIFEST'
  | 'SUBTITLE_MANIFEST_FAILED'
  | 'NO_JAPANESE_SUBTITLE_TRACK'
  | 'SUBTITLE_SEGMENT_FAILED';

/** Upper bounds that keep a hostile or broken manifest from exhausting memory. */
export const TVER_LIMITS = {
  maxSegments: 2_000,
  maxSegmentBytes: 2_000_000,
  maxTotalBytes: 40_000_000,
  maxManifestBytes: 4_000_000,
} as const;
