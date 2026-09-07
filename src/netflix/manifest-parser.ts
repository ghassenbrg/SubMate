import type {
  NetflixManifestSnapshot,
  NetflixSubtitleCandidate,
  NetflixSubtitleDownload,
} from './netflix-types';
import { isAllowedNetflixSubtitleUrl } from './url-policy';

type UnknownRecord = Record<string, unknown>;

const record = (value: unknown): UnknownRecord | undefined =>
  value && typeof value === 'object' && !Array.isArray(value)
    ? (value as UnknownRecord)
    : undefined;

const stringValue = (value: unknown, max = 160): string | undefined => {
  if (typeof value !== 'string' && typeof value !== 'number') return undefined;
  const result = String(value).trim();
  return result && result.length <= max ? result : undefined;
};

const values = (value: unknown): unknown[] => {
  if (Array.isArray(value)) return value;
  const object = record(value);
  return object ? Object.values(object) : [];
};

function downloadableUrls(value: unknown): string[] {
  const item = record(value);
  if (!item) return [];
  const result: string[] = [];
  for (const possible of values(item.downloadUrls)) {
    const url = stringValue(possible, 4096);
    if (url && isAllowedNetflixSubtitleUrl(url)) result.push(url);
  }
  for (const possible of values(item.urls)) {
    const url = stringValue(record(possible)?.url ?? possible, 4096);
    if (url && isAllowedNetflixSubtitleUrl(url)) result.push(url);
  }
  return [...new Set(result)].slice(0, 12);
}

function extractDownloads(track: UnknownRecord): NetflixSubtitleDownload[] {
  const downloadables = record(track.downloadables ?? track.ttDownloadables);
  if (!downloadables) return [];
  const result: NetflixSubtitleDownload[] = [];
  for (const [rawProfile, rawDownload] of Object.entries(downloadables).slice(0, 30)) {
    const download = record(rawDownload);
    const profile = stringValue(download?.profile ?? rawProfile, 120);
    if (!download || !profile) continue;
    const urls = downloadableUrls(download);
    if (!urls.length) continue;
    const image = download.isImage === true || /image|png|isc/i.test(profile);
    result.push({ profile, kind: image ? 'image' : 'text', urls });
  }
  return result;
}

function noneTrack(track: UnknownRecord, trackId: string): boolean {
  if (track.isNoneTrack === true || Number(track.rank) < 0) return true;
  const segments = trackId.split(';');
  return segments.length > 4 && segments[4] === '1';
}

function extractTrack(value: unknown): NetflixSubtitleCandidate | undefined {
  const track = record(value);
  if (!track) return undefined;
  const trackId = stringValue(track.id ?? track.new_track_id ?? track.newTrackId, 240);
  const language = stringValue(track.language ?? track.bcp47, 35);
  if (!trackId || !language) return undefined;
  const rawTrackType = stringValue(track.rawTrackType ?? track.raw_track_type, 80);
  const label = stringValue(
    track.languageDescription ?? track.language_description ?? track.displayName ?? language,
    160,
  ) ?? language;
  const downloads = extractDownloads(track);
  return {
    trackId,
    language,
    label,
    ...(rawTrackType ? { rawTrackType } : {}),
    isForcedNarrative:
      track.isForcedNarrative === true || track.is_forced_narrative === true || /forced/i.test(rawTrackType ?? ''),
    isNoneTrack: noneTrack(track, trackId),
    hydrated: track.hydrated !== false,
    downloads,
  };
}

function manifestFromUnknown(value: unknown): UnknownRecord | undefined {
  const root = record(value);
  if (!root) return undefined;
  const direct = record(root.result);
  if (direct && (direct.movieId ?? direct.movie_id) && (direct.textTracks ?? direct.timedtexttracks)) {
    return direct;
  }
  if ((root.movieId ?? root.movie_id) && (root.textTracks ?? root.timedtexttracks)) return root;
  return undefined;
}

export function snapshotFromManifest(value: unknown, now = Date.now()): NetflixManifestSnapshot | undefined {
  const manifest = manifestFromUnknown(value);
  if (!manifest) return undefined;
  const contentId = stringValue(manifest.movieId ?? manifest.movie_id, 80);
  if (!contentId) return undefined;
  const tracks = values(manifest.textTracks ?? manifest.timedtexttracks)
    .slice(0, 100)
    .map(extractTrack)
    .filter((track): track is NetflixSubtitleCandidate => Boolean(track));
  if (!tracks.length) return undefined;
  const recommended = record(manifest.recommendedMedia ?? manifest.recommended_media);
  const activeTextTrackId = stringValue(
    recommended?.textTrackId ?? recommended?.timedTextTrackId ?? recommended?.timed_text_track_id,
    240,
  );
  const audioTracks = values(manifest.audioTracks ?? manifest.audio_tracks).map(record).filter(Boolean);
  const nativeAudio = audioTracks.find((track) => track?.isNative === true) ?? audioTracks[0];
  const audioLanguage = stringValue(nativeAudio?.language ?? nativeAudio?.bcp47, 35);
  return {
    protocolVersion: 1,
    contentId,
    capturedAt: now,
    ...(activeTextTrackId ? { activeTextTrackId } : {}),
    ...(audioLanguage ? { audioLanguage } : {}),
    tracks,
  };
}

export function chooseSourceTrack(
  snapshot: NetflixManifestSnapshot,
  targetLanguage: string,
  preferredSourceLanguage?: string,
): { source: NetflixSubtitleCandidate | undefined; targetAlreadyAvailable: boolean; imageOnly: boolean } {
  const base = (language: string) => language.toLowerCase().split('-')[0];
  const targetAlreadyAvailable = snapshot.tracks.some(
    (track) => !track.isNoneTrack && base(track.language) === base(targetLanguage),
  );
  const usable = snapshot.tracks.filter((track) => !track.isNoneTrack && track.hydrated);
  const textual = usable.filter((track) => track.downloads.some((download) => download.kind === 'text'));
  const byLanguage = (language?: string) => {
    if (!language) return undefined;
    const matching = textual.filter((track) => base(track.language) === base(language));
    // Netflix can put a sparse forced-narrative track before the regular dialogue
    // track. Prefer the full track so a same-language match contains spoken lines.
    return matching.find((track) => !track.isForcedNarrative) ?? matching[0];
  };
  const source =
    byLanguage(preferredSourceLanguage) ??
    textual.find((track) => track.trackId === snapshot.activeTextTrackId) ??
    byLanguage(snapshot.audioLanguage) ??
    textual.find((track) => !track.isForcedNarrative) ??
    textual[0];
  return { source, targetAlreadyAvailable, imageOnly: !source && usable.some((track) => track.downloads.some((d) => d.kind === 'image')) };
}

const TEXT_PROFILE_PRIORITY = [
  'dfxp-ls-sdh',
  'webvtt-lssdh-ios8',
  'webvtt-lssdh-ios8-compat',
  'simplesdh',
];

export function chooseTextDownload(track: NetflixSubtitleCandidate): NetflixSubtitleDownload | undefined {
  const text = track.downloads.filter((download) => download.kind === 'text');
  return [...text].sort((a, b) => {
    const rank = (profile: string) => {
      const normalized = profile.toLowerCase().replaceAll(/[^a-z0-9]/g, '');
      const index = TEXT_PROFILE_PRIORITY.findIndex((value) =>
        normalized.includes(value.replaceAll(/[^a-z0-9]/g, '')),
      );
      return index < 0 ? TEXT_PROFILE_PRIORITY.length : index;
    };
    return rank(a.profile) - rank(b.profile);
  })[0];
}

export function isManifestSnapshot(value: unknown): value is NetflixManifestSnapshot {
  const snapshot = record(value);
  if (!snapshot || snapshot.protocolVersion !== 1) return false;
  if (!stringValue(snapshot.contentId, 80) || !Number.isFinite(snapshot.capturedAt)) return false;
  if (!Array.isArray(snapshot.tracks) || snapshot.tracks.length > 100) return false;
  return snapshot.tracks.every((candidate) => {
    const track = record(candidate);
    if (!track || !stringValue(track.trackId, 240) || !stringValue(track.language, 35)) return false;
    if (!Array.isArray(track.downloads) || track.downloads.length > 30) return false;
    return track.downloads.every((raw) => {
      const download = record(raw);
      return Boolean(
        download &&
        stringValue(download.profile, 120) &&
        ['text', 'image', 'unknown'].includes(String(download.kind)) &&
        Array.isArray(download.urls) &&
        download.urls.length <= 12 &&
        download.urls.every((url) => typeof url === 'string' && isAllowedNetflixSubtitleUrl(url)),
      );
    });
  });
}
