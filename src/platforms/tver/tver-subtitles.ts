import { mergeSegmentCues, parseTimestampMap, type SegmentCues } from '../../core/subtitles/segments';
import { FlixTranslateError } from '../../shared-errors';
import type { SubtitleCue } from '../../subtitles/models';
import { normalizeCues } from '../../subtitles/normalize';
import { parseVttDocument } from '../../subtitles/vtt-parser';
import type { TVerSubtitleSegment } from './tver-types';

interface ParsedSegment {
  segment: TVerSubtitleSegment;
  header: string;
  cues: Array<{ id?: string; startMs: number; endMs: number; sourceText: string }>;
  mapOffsetMs: number | undefined;
}

/**
 * Presentation-clock origin of the stream, in milliseconds.
 *
 * `X-TIMESTAMP-MAP` relates a segment's cue clock to the MPEG-2 presentation
 * clock, but a media element's `currentTime` starts at zero while a stream's
 * PTS usually starts somewhere else entirely. Converting a cue to PTS time
 * without removing that origin shifts the whole track by the stream's initial
 * PTS — commonly several seconds.
 *
 * The origin is read from the earliest segment that carries a map: that
 * segment begins at `startMs` on the player timeline, so whatever its map adds
 * beyond `startMs` is precisely the offset the player does not share.
 */
function presentationOrigin(parsed: ParsedSegment[]): number | undefined {
  let origin: number | undefined;
  let earliestStart = Number.POSITIVE_INFINITY;
  for (const entry of parsed) {
    if (entry.mapOffsetMs === undefined) continue;
    if (entry.segment.startMs >= earliestStart) continue;
    earliestStart = entry.segment.startMs;
    origin = entry.mapOffsetMs - entry.segment.startMs;
  }
  return origin;
}

/**
 * Turns segmented WebVTT into one normalized, chronological episode track.
 *
 * Removing the presentation origin makes both common segmented-WebVTT
 * conventions land correctly without needing to detect which one is in use:
 * a constant `MPEGTS` with episode-absolute cue clocks collapses to a zero
 * offset, while a per-segment `MPEGTS` with segment-local clocks collapses to
 * that segment's playlist position.
 */
export function cuesFromSegments(segments: TVerSubtitleSegment[]): SubtitleCue[] {
  const parsed: ParsedSegment[] = segments.map((segment) => {
    const document = parseVttDocument(segment.text);
    return {
      segment,
      header: document.header,
      cues: document.cues,
      mapOffsetMs: parseTimestampMap(document.header),
    };
  });

  // Computed across every segment, including caption-free ones, because the
  // segment that establishes the origin often carries no cues of its own.
  const origin = presentationOrigin(parsed);

  const inputs: SegmentCues[] = [];
  for (const entry of parsed) {
    if (!entry.cues.length) continue;
    let offsetMs: number;
    if (entry.mapOffsetMs !== undefined && origin !== undefined) {
      offsetMs = entry.mapOffsetMs - origin;
    } else {
      // No timestamp map: cue times are segment-relative and need the playlist
      // position, unless they already run past this segment's own start, which
      // means they are episode-absolute already.
      const earliest = Math.min(...entry.cues.map((cue) => cue.startMs));
      const looksAbsolute = earliest >= entry.segment.startMs - 1_000;
      offsetMs = looksAbsolute ? 0 : entry.segment.startMs;
    }
    inputs.push({
      cues: entry.cues.map((cue) => ({
        id: cue.id ?? '',
        startMs: cue.startMs,
        endMs: cue.endMs,
        sourceText: cue.sourceText,
      })),
      offsetMs,
    });
  }

  const merged = mergeSegmentCues(inputs);
  // Cue ids from segmented WebVTT repeat across segments, so they are dropped
  // in favour of stable positional ids assigned after merging.
  const cues = normalizeCues(merged.map((cue) => ({
    startMs: cue.startMs,
    endMs: cue.endMs,
    sourceText: cue.sourceText,
  })));
  if (!cues.length) {
    throw new FlixTranslateError('SUBTITLE_PARSE_FAILED', 'No subtitle cues found in TVer segments');
  }
  return cues;
}
