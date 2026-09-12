import type { SubtitleCue } from '../../subtitles/models';
import { normalizeText } from '../../subtitles/normalize';

/**
 * Boundary-duplicate tolerance. Segmented WebVTT repeats cues across segment
 * edges with slightly shifted timings; a wider window risks collapsing two
 * genuinely different captions that happen to share the same text.
 */
export const DUPLICATE_TOLERANCE_MS = 100;

function parseVttClock(value: string): number | undefined {
  const parts = value.trim().split(':');
  if (parts.length < 2 || parts.length > 3) return undefined;
  const seconds = Number(parts.pop());
  const minutes = Number(parts.pop());
  const hours = parts.length ? Number(parts.pop()) : 0;
  if (![seconds, minutes, hours].every(Number.isFinite)) return undefined;
  return Math.round((hours * 3600 + minutes * 60 + seconds) * 1000);
}

/**
 * WebVTT `X-TIMESTAMP-MAP` relates a cue clock to an MPEG-2 presentation clock.
 * Segmented HLS WebVTT uses it to place a segment on the media timeline.
 * Returns the millisecond offset to add to that segment's own cue timings.
 */
export function parseTimestampMap(header: string): number | undefined {
  const match = /X-TIMESTAMP-MAP\s*[:=]\s*(.+)/i.exec(header);
  if (!match?.[1]) return undefined;
  let localMs: number | undefined;
  let mpegMs: number | undefined;
  for (const part of match[1].split(',')) {
    // Pairs are `KEY:VALUE`, and LOCAL's own value contains colons, so only the
    // first separator may be used to split key from value.
    const separator = part.indexOf(':');
    if (separator < 0) continue;
    const key = part.slice(0, separator).trim().toUpperCase();
    const value = part.slice(separator + 1).trim();
    if (!value) continue;
    if (key === 'LOCAL') localMs = parseVttClock(value);
    else if (key === 'MPEGTS') {
      const ticks = Number(value);
      // The MPEG-2 transport stream clock runs at 90 kHz.
      if (Number.isFinite(ticks)) mpegMs = Math.round((ticks / 90_000) * 1000);
    }
  }
  if (localMs === undefined || mpegMs === undefined) return undefined;
  return mpegMs - localMs;
}

export interface SegmentCues {
  cues: SubtitleCue[];
  /** Offset applied to every cue in this segment, in milliseconds. */
  offsetMs: number;
}

export type MergedCue = Omit<SubtitleCue, 'id'> & { id?: string };

/**
 * Merges per-segment cue lists into one chronological episode track.
 *
 * Deduplication keys on normalized text plus near-equal timings, so a cue
 * repeated at a segment boundary collapses while two distinct lines that share
 * text (a repeated catchphrase minutes apart) are both preserved.
 */
export function mergeSegmentCues(inputs: SegmentCues[]): MergedCue[] {
  const collected: Array<{ startMs: number; endMs: number; sourceText: string }> = [];
  for (const input of inputs) {
    for (const cue of input.cues) {
      const startMs = cue.startMs + input.offsetMs;
      const endMs = cue.endMs + input.offsetMs;
      const sourceText = normalizeText(cue.sourceText);
      if (!sourceText || !Number.isFinite(startMs) || !Number.isFinite(endMs)) continue;
      if (startMs < 0 || endMs < startMs) continue;
      collected.push({ startMs, endMs, sourceText });
    }
  }
  collected.sort((a, b) => a.startMs - b.startMs || a.endMs - b.endMs);

  // Candidates are grouped by text so duplicate detection stays linear overall
  // instead of rescanning every previously accepted cue for each new one.
  const byText = new Map<string, Array<{ startMs: number; endMs: number; sourceText: string }>>();
  const result: Array<{ startMs: number; endMs: number; sourceText: string }> = [];
  for (const cue of collected) {
    const siblings = byText.get(cue.sourceText);
    if (siblings) {
      const near = siblings.find(
        (existing) => Math.abs(existing.startMs - cue.startMs) <= DUPLICATE_TOLERANCE_MS,
      );
      if (near) {
        // A boundary repeat can arrive as the same text with a later end time.
        // Widen the accepted cue rather than emitting an overlapping twin.
        near.endMs = Math.max(near.endMs, cue.endMs);
        continue;
      }
    }
    const accepted = { ...cue };
    result.push(accepted);
    if (siblings) siblings.push(accepted);
    else byText.set(cue.sourceText, [accepted]);
  }
  return result;
}
