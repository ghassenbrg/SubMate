import { sameLanguage } from '../../core/subtitles/language';
import { isAllowedPrimeSubtitleUrl } from './prime-url-policy';

export interface PrimeSubtitleCandidate {
  url: string;
  language: string;
  label?: string;
  /** Forced-narrative tracks cover only foreign dialogue and signage. */
  forced: boolean;
  /** Hint for the parser: dfxp/ttml or vtt, when the payload states one. */
  format?: string;
}

export interface PrimePlaybackSnapshot {
  protocolVersion: 1;
  contentId: string;
  capturedAt: number;
  audioLanguage?: string;
  subtitles: PrimeSubtitleCandidate[];
}

type UnknownRecord = Record<string, unknown>;

const record = (value: unknown): UnknownRecord | undefined =>
  value && typeof value === 'object' && !Array.isArray(value) ? (value as UnknownRecord) : undefined;

const stringValue = (value: unknown, max = 160): string | undefined => {
  if (typeof value !== 'string' && typeof value !== 'number') return undefined;
  const result = String(value).trim();
  return result && result.length <= max ? result : undefined;
};

/** Field spellings Amazon has used for the same concept across payloads. */
const URL_KEYS = ['url', 'uri', 'subtitleUrl', 'src'];
const LANGUAGE_KEYS = ['languageCode', 'language', 'bcp47', 'locale', 'languageTag'];
const LABEL_KEYS = ['displayName', 'label', 'title', 'name'];
const FORMAT_KEYS = ['format', 'type', 'subtype', 'mimeType'];

const pick = (item: UnknownRecord, keys: string[], max = 160): string | undefined => {
  for (const key of keys) {
    const value = stringValue(item[key], max);
    if (value) return value;
  }
  return undefined;
};

const looksForced = (item: UnknownRecord, containerKey: string): boolean => {
  if (item.forced === true || item.isForced === true) return true;
  const haystack = `${containerKey} ${pick(item, ['type', 'subtype', 'displayName', 'name'], 200) ?? ''}`.toLowerCase();
  return haystack.includes('forced') || haystack.includes('narrative');
};

/**
 * Extracts subtitle descriptors from a Prime Video playback payload.
 *
 * The payload is walked structurally rather than by a fixed path: Amazon has
 * used several shapes and key spellings for the same data, and a rigid path
 * would silently stop matching after any of them changes. A descriptor counts
 * only when it carries both an Amazon-hosted URL and a language tag, so
 * unrelated URLs elsewhere in the payload cannot be mistaken for captions.
 */
export interface SubtitleScan {
  accepted: PrimeSubtitleCandidate[];
  /** Hostnames of descriptors rejected by the URL policy. Hostname only — a
   *  signed path must never be retained for diagnostics. */
  rejectedHosts: string[];
}

function collectSubtitles(root: unknown): SubtitleScan {
  const found: PrimeSubtitleCandidate[] = [];
  const rejected = new Set<string>();
  const seen = new Set<string>();
  let visited = 0;

  const walk = (value: unknown, key: string, depth: number) => {
    if (depth > 12 || visited > 20_000 || found.length >= 80) return;
    visited += 1;
    if (Array.isArray(value)) {
      for (const entry of value.slice(0, 200)) walk(entry, key, depth + 1);
      return;
    }
    const item = record(value);
    if (!item) return;

    const url = pick(item, URL_KEYS, 4096);
    const language = pick(item, LANGUAGE_KEYS, 35);
    if (url && language && !isAllowedPrimeSubtitleUrl(url)) {
      try {
        rejected.add(new URL(url).hostname);
      } catch {
        rejected.add('(unparseable)');
      }
    }
    if (url && language && isAllowedPrimeSubtitleUrl(url) && !seen.has(url)) {
      seen.add(url);
      const label = pick(item, LABEL_KEYS);
      const format = pick(item, FORMAT_KEYS, 80);
      found.push({
        url,
        language,
        ...(label ? { label } : {}),
        forced: looksForced(item, key),
        ...(format ? { format } : {}),
      });
    }
    for (const [childKey, child] of Object.entries(item).slice(0, 200)) walk(child, childKey, depth + 1);
  };

  walk(root, '', 0);
  return { accepted: found, rejectedHosts: [...rejected].slice(0, 10) };
}

/** Exposed so the page agent can explain a miss without leaking a URL. */
export const scanForSubtitles = (root: unknown): SubtitleScan => collectSubtitles(root);

/** Amazon identifies a title by ASIN; several payload paths can carry it. */
function extractContentId(root: unknown): string | undefined {
  const direct = record(root);
  if (!direct) return undefined;
  const catalog = record(record(direct.catalogMetadata)?.catalog);
  const candidates = [
    catalog?.id,
    catalog?.asin,
    direct.asin,
    direct.titleId,
    direct.titleID,
    record(direct.catalog)?.id,
  ];
  for (const candidate of candidates) {
    const value = stringValue(candidate, 64);
    if (value && /^[A-Za-z0-9._-]{6,64}$/.test(value)) return value;
  }
  return undefined;
}

/**
 * Last-resort identity when neither the payload nor the route names the title.
 * Derived from the track set, which is stable for a given title across a
 * session, rather than from a signed URL, which is not.
 */
function derivedContentId(subtitles: PrimeSubtitleCandidate[]): string | undefined {
  const basis = subtitles
    .map((track) => `${track.language}:${track.forced ? 'f' : 'd'}:${track.label ?? ''}`)
    .sort()
    .join('|');
  if (!basis) return undefined;
  let hash = 2_166_136_261;
  for (let index = 0; index < basis.length; index += 1) {
    hash ^= basis.charCodeAt(index);
    hash = Math.imul(hash, 16_777_619);
  }
  return `derived-${(hash >>> 0).toString(36)}`;
}

function extractAudioLanguage(root: unknown): string | undefined {
  const direct = record(root);
  if (!direct) return undefined;
  const catalog = record(record(direct.catalogMetadata)?.catalog);
  return stringValue(catalog?.originalLanguage ?? direct.audioLanguage ?? direct.defaultAudioLanguage, 35);
}

/**
 * Builds a snapshot from a payload only when it genuinely looks like playback
 * resources — the page emits a great deal of unrelated JSON.
 */
export function snapshotFromPlaybackResources(
  value: unknown,
  fallbackContentId?: string,
  now = Date.now(),
): PrimePlaybackSnapshot | undefined {
  if (!record(value)) return undefined;
  const { accepted: subtitles } = collectSubtitles(value);
  if (!subtitles.length) return undefined;
  // Prefer the payload's own id, then the route's. Neither is guaranteed, and
  // failing here would discard a perfectly good subtitle track, so fall back to
  // a value derived from the payload itself.
  const contentId = extractContentId(value) ?? fallbackContentId ?? derivedContentId(subtitles);
  if (!contentId) return undefined;
  const audioLanguage = extractAudioLanguage(value);
  return {
    protocolVersion: 1,
    contentId,
    capturedAt: now,
    ...(audioLanguage ? { audioLanguage } : {}),
    subtitles,
  };
}

/**
 * Picks the track to translate. A full dialogue track always beats a
 * forced-narrative one, which carries only signage and foreign lines.
 */
export function chooseSubtitleTrack(
  snapshot: PrimePlaybackSnapshot,
  targetLanguage: string,
  preferredSourceLanguage?: string,
): { source: PrimeSubtitleCandidate | undefined; targetAlreadyAvailable: boolean } {
  const targetAlreadyAvailable = snapshot.subtitles.some(
    (track) => !track.forced && sameLanguage(track.language, targetLanguage),
  );
  const byLanguage = (language?: string) => {
    if (!language) return undefined;
    const matching = snapshot.subtitles.filter((track) => sameLanguage(track.language, language));
    return matching.find((track) => !track.forced) ?? matching[0];
  };
  const source =
    byLanguage(preferredSourceLanguage) ??
    byLanguage(snapshot.audioLanguage) ??
    snapshot.subtitles.find((track) => !track.forced) ??
    snapshot.subtitles[0];
  return { source, targetAlreadyAvailable };
}

/** Validates an untrusted snapshot arriving from the page realm. */
export function isPrimeSnapshot(value: unknown): value is PrimePlaybackSnapshot {
  const snapshot = record(value);
  if (!snapshot || snapshot.protocolVersion !== 1) return false;
  if (!stringValue(snapshot.contentId, 64) || !Number.isFinite(snapshot.capturedAt)) return false;
  if (!Array.isArray(snapshot.subtitles) || snapshot.subtitles.length > 80) return false;
  return snapshot.subtitles.every((raw) => {
    const track = record(raw);
    return Boolean(track && stringValue(track.language, 35) && typeof track.forced === 'boolean');
  });
}
