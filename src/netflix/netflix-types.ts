export interface NetflixSubtitleDownload {
  profile: string;
  kind: 'text' | 'image' | 'unknown';
  urls: string[];
}

export interface NetflixSubtitleCandidate {
  trackId: string;
  language: string;
  label: string;
  rawTrackType?: string;
  isForcedNarrative: boolean;
  isNoneTrack: boolean;
  hydrated: boolean;
  downloads: NetflixSubtitleDownload[];
}

export interface NetflixManifestSnapshot {
  protocolVersion: 1;
  contentId: string;
  capturedAt: number;
  activeTextTrackId?: string;
  audioLanguage?: string;
  tracks: NetflixSubtitleCandidate[];
}

export const BRIDGE_NAMESPACE = 'submate:netflix-manifest:v1';

export type NetflixBridgeMessage =
  | { namespace: typeof BRIDGE_NAMESPACE; type: 'manifest'; snapshot: NetflixManifestSnapshot }
  | { namespace: typeof BRIDGE_NAMESPACE; type: 'manifest-replay-request' }
  | { namespace: typeof BRIDGE_NAMESPACE; type: 'navigation'; contentId?: string }
  | { namespace: typeof BRIDGE_NAMESPACE; type: 'subtitle-request'; requestId: string; contentId: string; trackId: string; profile: string }
  | { namespace: typeof BRIDGE_NAMESPACE; type: 'subtitle-response'; requestId: string; ok: true; text: string; contentType: string }
  | { namespace: typeof BRIDGE_NAMESPACE; type: 'subtitle-response'; requestId: string; ok: false; error: string };
