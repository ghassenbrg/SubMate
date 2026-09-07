import type { SubtitleCue } from '../subtitles/models';

export class CueIndex {
  private readonly cues: SubtitleCue[];
  private readonly cuesBySourceText = new Map<string, SubtitleCue[]>();

  constructor(cues: SubtitleCue[]) {
    this.cues = [...cues].sort((a, b) => a.startMs - b.startMs || a.endMs - b.endMs);
    for (const cue of this.cues) {
      const key = comparableText(cue.sourceText);
      if (!key) continue;
      const matches = this.cuesBySourceText.get(key) ?? [];
      matches.push(cue);
      this.cuesBySourceText.set(key, matches);
    }
  }

  findAt(timeMs: number): SubtitleCue[] {
    let low = 0;
    let high = this.cues.length - 1;
    let latest = -1;
    while (low <= high) {
      const middle = (low + high) >>> 1;
      const cue = this.cues[middle];
      if (cue && cue.startMs <= timeMs) {
        latest = middle;
        low = middle + 1;
      } else high = middle - 1;
    }
    if (latest < 0) return [];
    const active: SubtitleCue[] = [];
    for (let index = latest; index >= 0; index -= 1) {
      const cue = this.cues[index];
      if (!cue) continue;
      if (cue.endMs >= timeMs && cue.startMs <= timeMs) active.unshift(cue);
      // Subtitle overlaps are short; stop after a generous 30-second lookback.
      if (cue.startMs < timeMs - 30_000) break;
    }
    return active;
  }

  /**
   * Netflix occasionally renders a text cue on a player clock that differs from
   * the downloadable TTML clock. Match the visible source line as a recovery
   * path, preferring the occurrence nearest to the current playback position.
   */
  findBySourceText(text: string, timeMs: number): SubtitleCue[] {
    const matches = this.cuesBySourceText.get(comparableText(text));
    if (!matches?.length) return [];
    const distance = (cue: SubtitleCue) => {
      if (timeMs < cue.startMs) return cue.startMs - timeMs;
      if (timeMs > cue.endMs) return timeMs - cue.endMs;
      return 0;
    };
    const closest = [...matches].sort((a, b) => distance(a) - distance(b))[0];
    if (!closest) return [];
    return this.cues.filter((cue) => cue.startMs === closest.startMs && cue.endMs === closest.endMs);
  }
}

const comparableText = (value: string): string => value
  .normalize('NFKC')
  .replaceAll(/[\s\u200b\u2060]+/gu, '')
  .trim();
