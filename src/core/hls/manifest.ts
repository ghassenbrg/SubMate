/**
 * Minimal, dependency-free HLS playlist parsing focused on subtitle discovery.
 *
 * Only the tags SubMate needs are interpreted; everything else is ignored
 * so that unrelated manifest evolution cannot break subtitle extraction. No CDN
 * host, path shape or segment naming convention is assumed anywhere.
 */

export interface HlsMediaTrack {
  type: string;
  groupId?: string;
  name?: string;
  language?: string;
  assocLanguage?: string;
  isDefault: boolean;
  autoselect: boolean;
  forced: boolean;
  characteristics?: string;
  /** Absolute URI, resolved against the manifest it was declared in. */
  uri?: string;
}

export interface HlsSegment {
  uri: string;
  durationMs: number;
  /** Cumulative start offset within the playlist, in milliseconds. */
  startMs: number;
  discontinuity: boolean;
}

export interface HlsMediaPlaylist {
  segments: HlsSegment[];
  targetDurationMs: number;
  /** A VOD/complete playlist ends with #EXT-X-ENDLIST. */
  complete: boolean;
  /** Live/sliding playlists renumber; retained for correct dedupe decisions. */
  mediaSequence: number;
}

/** Splits a manifest into logical lines, tolerating CRLF and stray whitespace. */
const manifestLines = (text: string): string[] =>
  text
    .replace(/^﻿/, '')
    .replaceAll('\r\n', '\n')
    .replaceAll('\r', '\n')
    .split('\n')
    .map((line) => line.trim())
    .filter((line) => line.length > 0);

/**
 * Parses an HLS attribute list. Quoted values may legally contain commas and
 * `=`, so a naive split on those characters corrupts real manifests.
 */
export function parseAttributeList(input: string): Record<string, string> {
  const attributes: Record<string, string> = {};
  let index = 0;
  while (index < input.length) {
    const equals = input.indexOf('=', index);
    if (equals < 0) break;
    const key = input.slice(index, equals).trim().toUpperCase();
    index = equals + 1;
    let value: string;
    if (input[index] === '"') {
      const end = input.indexOf('"', index + 1);
      if (end < 0) {
        value = input.slice(index + 1);
        index = input.length;
      } else {
        value = input.slice(index + 1, end);
        index = end + 1;
      }
    } else {
      const comma = input.indexOf(',', index);
      const end = comma < 0 ? input.length : comma;
      value = input.slice(index, end).trim();
      index = end;
    }
    if (input[index] === ',') index += 1;
    if (key) attributes[key] = value;
  }
  return attributes;
}

const resolve = (uri: string, baseUrl: string): string | undefined => {
  try {
    return new URL(uri, baseUrl).toString();
  } catch {
    return undefined;
  }
};

/**
 * Extracts every `#EXT-X-MEDIA` declaration from a master playlist, resolving
 * relative URIs against the master manifest's own URL.
 */
export function parseMasterManifest(text: string, baseUrl: string): HlsMediaTrack[] {
  const tracks: HlsMediaTrack[] = [];
  for (const line of manifestLines(text)) {
    if (!line.startsWith('#EXT-X-MEDIA:')) continue;
    const attributes = parseAttributeList(line.slice('#EXT-X-MEDIA:'.length));
    const type = (attributes.TYPE ?? '').toUpperCase();
    if (!type) continue;
    const uri = attributes.URI ? resolve(attributes.URI, baseUrl) : undefined;
    tracks.push({
      type,
      ...(attributes['GROUP-ID'] ? { groupId: attributes['GROUP-ID'] } : {}),
      ...(attributes.NAME ? { name: attributes.NAME } : {}),
      ...(attributes.LANGUAGE ? { language: attributes.LANGUAGE } : {}),
      ...(attributes['ASSOC-LANGUAGE'] ? { assocLanguage: attributes['ASSOC-LANGUAGE'] } : {}),
      isDefault: (attributes.DEFAULT ?? '').toUpperCase() === 'YES',
      autoselect: (attributes.AUTOSELECT ?? '').toUpperCase() === 'YES',
      forced: (attributes.FORCED ?? '').toUpperCase() === 'YES',
      ...(attributes.CHARACTERISTICS ? { characteristics: attributes.CHARACTERISTICS } : {}),
      ...(uri ? { uri } : {}),
    });
  }
  return tracks;
}

/** True when a manifest looks like a master playlist rather than a media playlist. */
export const isMasterManifest = (text: string): boolean =>
  /^#EXT-X-(?:STREAM-INF|MEDIA)[:\s]/m.test(text);

/**
 * Parses a media (segment) playlist. Segment start offsets accumulate from
 * `#EXTINF` durations, which is what a WebVTT `X-TIMESTAMP-MAP`-free segment
 * needs in order to be placed on the episode timeline.
 */
export function parseMediaPlaylist(text: string, baseUrl: string): HlsMediaPlaylist {
  const segments: HlsSegment[] = [];
  let targetDurationMs = 0;
  let complete = false;
  let mediaSequence = 0;
  let pendingDurationMs: number | undefined;
  let pendingDiscontinuity = false;
  let cursorMs = 0;

  for (const line of manifestLines(text)) {
    if (line.startsWith('#EXT-X-TARGETDURATION:')) {
      targetDurationMs = Math.round(Number(line.slice('#EXT-X-TARGETDURATION:'.length)) * 1000) || 0;
      continue;
    }
    if (line.startsWith('#EXT-X-MEDIA-SEQUENCE:')) {
      mediaSequence = Number(line.slice('#EXT-X-MEDIA-SEQUENCE:'.length)) || 0;
      continue;
    }
    if (line === '#EXT-X-ENDLIST') {
      complete = true;
      continue;
    }
    if (line === '#EXT-X-DISCONTINUITY') {
      pendingDiscontinuity = true;
      continue;
    }
    if (line.startsWith('#EXTINF:')) {
      const seconds = Number.parseFloat(line.slice('#EXTINF:'.length).split(',')[0] ?? '');
      pendingDurationMs = Number.isFinite(seconds) ? Math.round(seconds * 1000) : 0;
      continue;
    }
    if (line.startsWith('#')) continue;
    const uri = resolve(line, baseUrl);
    if (!uri) {
      pendingDurationMs = undefined;
      pendingDiscontinuity = false;
      continue;
    }
    const durationMs = pendingDurationMs ?? 0;
    segments.push({ uri, durationMs, startMs: cursorMs, discontinuity: pendingDiscontinuity });
    cursorMs += durationMs;
    pendingDurationMs = undefined;
    pendingDiscontinuity = false;
  }

  return { segments, targetDurationMs, complete, mediaSequence };
}
