import { describe, expect, it } from 'vitest';
import { DUPLICATE_TOLERANCE_MS, mergeSegmentCues, parseTimestampMap } from '../../src/core/subtitles/segments';
import { parseVttDocument } from '../../src/subtitles/vtt-parser';
import { cuesFromSegments } from '../../src/platforms/tver/tver-subtitles';

const segment = (body: string, header = 'WEBVTT') => `${header}\n\n${body}\n`;

describe('X-TIMESTAMP-MAP', () => {
  it('converts the 90 kHz MPEG clock into a millisecond offset', () => {
    // MPEGTS 900000 = 10s; LOCAL 0 → every cue shifts forward by 10s.
    expect(parseTimestampMap('WEBVTT\nX-TIMESTAMP-MAP=LOCAL:00:00:00.000,MPEGTS:900000')).toBe(10_000);
  });

  it('accounts for a non-zero LOCAL anchor', () => {
    expect(parseTimestampMap('X-TIMESTAMP-MAP=LOCAL:00:00:05.000,MPEGTS:900000')).toBe(5_000);
  });

  it('returns undefined when the map is absent or incomplete', () => {
    expect(parseTimestampMap('WEBVTT')).toBeUndefined();
    expect(parseTimestampMap('X-TIMESTAMP-MAP=LOCAL:00:00:00.000')).toBeUndefined();
  });
});

describe('WebVTT document parsing', () => {
  it('separates the header from cues and keeps Japanese text intact', () => {
    const document = parseVttDocument(segment('00:00:01.000 --> 00:00:03.000\nどうしたの？', 'WEBVTT\nX-TIMESTAMP-MAP=LOCAL:00:00:00.000,MPEGTS:0'));
    expect(document.header).toContain('X-TIMESTAMP-MAP');
    expect(document.cues).toHaveLength(1);
    expect(document.cues[0]?.sourceText).toBe('どうしたの？');
  });

  it('returns an empty cue list for a segment with no captions', () => {
    expect(parseVttDocument('WEBVTT\n\n').cues).toEqual([]);
  });

  it('strips styling tags but preserves multiline structure', () => {
    const document = parseVttDocument(segment('00:00:01.000 --> 00:00:02.000\n<v Speaker><b>一行目</b>\n<i>二行目</i>'));
    expect(document.cues[0]?.sourceText).toBe('一行目\n二行目');
  });
});

describe('segment merging and deduplication', () => {
  it('collapses a cue repeated across a segment boundary', () => {
    const merged = mergeSegmentCues([
      { cues: [{ id: '', startMs: 9_000, endMs: 11_000, sourceText: '同じ台詞' }], offsetMs: 0 },
      // The next segment repeats the boundary cue a few ms off.
      { cues: [{ id: '', startMs: 9_040, endMs: 11_000, sourceText: '同じ台詞' }], offsetMs: 0 },
    ]);
    expect(merged).toHaveLength(1);
  });

  it('extends rather than duplicates when the repeat has a later end time', () => {
    const merged = mergeSegmentCues([
      { cues: [{ id: '', startMs: 1_000, endMs: 2_000, sourceText: 'つづく' }], offsetMs: 0 },
      { cues: [{ id: '', startMs: 1_000, endMs: 4_000, sourceText: 'つづく' }], offsetMs: 0 },
    ]);
    expect(merged).toHaveLength(1);
    expect(merged[0]?.endMs).toBe(4_000);
  });

  it('keeps two genuinely different captions that share the same text', () => {
    const merged = mergeSegmentCues([
      { cues: [{ id: '', startMs: 1_000, endMs: 2_000, sourceText: 'はい' }], offsetMs: 0 },
      // Far apart in time: a repeated catchphrase, not a boundary duplicate.
      { cues: [{ id: '', startMs: 600_000, endMs: 601_000, sourceText: 'はい' }], offsetMs: 0 },
    ]);
    expect(merged).toHaveLength(2);
  });

  it('treats a shift beyond the tolerance as a distinct cue', () => {
    const merged = mergeSegmentCues([
      { cues: [{ id: '', startMs: 5_000, endMs: 6_000, sourceText: 'ねえ' }], offsetMs: 0 },
      { cues: [{ id: '', startMs: 5_000 + DUPLICATE_TOLERANCE_MS + 50, endMs: 6_200, sourceText: 'ねえ' }], offsetMs: 0 },
    ]);
    expect(merged).toHaveLength(2);
  });

  it('applies the per-segment offset and sorts chronologically', () => {
    const merged = mergeSegmentCues([
      { cues: [{ id: '', startMs: 500, endMs: 1_000, sourceText: '後' }], offsetMs: 20_000 },
      { cues: [{ id: '', startMs: 500, endMs: 1_000, sourceText: '先' }], offsetMs: 0 },
    ]);
    expect(merged.map((cue) => cue.sourceText)).toEqual(['先', '後']);
    expect(merged[1]?.startMs).toBe(20_500);
  });

  it('discards cues with impossible timings', () => {
    const merged = mergeSegmentCues([
      { cues: [{ id: '', startMs: 5_000, endMs: 1_000, sourceText: 'reversed' }], offsetMs: 0 },
      { cues: [{ id: '', startMs: 1_000, endMs: 2_000, sourceText: '' }], offsetMs: 0 },
    ]);
    expect(merged).toEqual([]);
  });
});

describe('TVer segmented track assembly', () => {
  it('places segments using X-TIMESTAMP-MAP when present', () => {
    const cues = cuesFromSegments([
      {
        startMs: 0,
        text: segment('00:00:01.000 --> 00:00:02.000\n一番目', 'WEBVTT\nX-TIMESTAMP-MAP=LOCAL:00:00:00.000,MPEGTS:0'),
      },
      {
        startMs: 10_000,
        // Local clock restarts, but the map anchors it at 10s on the media clock.
        text: segment('00:00:01.000 --> 00:00:02.000\n二番目', 'WEBVTT\nX-TIMESTAMP-MAP=LOCAL:00:00:00.000,MPEGTS:900000'),
      },
    ]);
    expect(cues.map((cue) => [cue.startMs, cue.sourceText])).toEqual([
      [1_000, '一番目'],
      [11_000, '二番目'],
    ]);
  });

  it('falls back to the playlist offset for segment-relative cue clocks', () => {
    const cues = cuesFromSegments([
      { startMs: 0, text: segment('00:00:01.000 --> 00:00:02.000\nA') },
      { startMs: 30_000, text: segment('00:00:02.000 --> 00:00:03.000\nB') },
    ]);
    expect(cues.map((cue) => cue.startMs)).toEqual([1_000, 32_000]);
  });

  it('leaves already-absolute segment timings untouched', () => {
    const cues = cuesFromSegments([
      { startMs: 0, text: segment('00:00:01.000 --> 00:00:02.000\nA') },
      // Cue times already sit past the segment start: absolute, not relative.
      { startMs: 30_000, text: segment('00:00:31.000 --> 00:00:32.000\nB') },
    ]);
    expect(cues.map((cue) => cue.startMs)).toEqual([1_000, 31_000]);
  });

  it('assigns stable positional ids and skips empty segments', () => {
    const cues = cuesFromSegments([
      { startMs: 0, text: 'WEBVTT\n\n' },
      { startMs: 0, text: segment('00:00:01.000 --> 00:00:02.000\nだけ') },
    ]);
    expect(cues).toHaveLength(1);
    expect(cues[0]?.id).toMatch(/^c\d{6}$/);
  });

  it('removes the stream presentation origin instead of shifting the track', () => {
    // Regression: a stream whose PTS starts at 9s (810000 ticks) made every cue
    // land 9s late, so a caption spoken at 0:16 was written out at 0:25.
    const cues = cuesFromSegments([
      {
        startMs: 0,
        text: segment(
          '00:00:16.000 --> 00:00:18.000\n本編の台詞',
          'WEBVTT\nX-TIMESTAMP-MAP=LOCAL:00:00:00.000,MPEGTS:810000',
        ),
      },
    ]);
    expect(cues[0]?.startMs).toBe(16_000);
    expect(cues[0]?.endMs).toBe(18_000);
  });

  it('handles per-segment presentation clocks with segment-local cue times', () => {
    const cues = cuesFromSegments([
      {
        startMs: 0,
        // Origin segment: PTS 9s corresponds to player time 0.
        text: segment('00:00:01.000 --> 00:00:02.000\n一番目', 'WEBVTT\nX-TIMESTAMP-MAP=LOCAL:00:00:00.000,MPEGTS:810000'),
      },
      {
        startMs: 10_000,
        // PTS 19s = player time 10s; the local clock restarts each segment.
        text: segment('00:00:06.000 --> 00:00:07.000\n二番目', 'WEBVTT\nX-TIMESTAMP-MAP=LOCAL:00:00:00.000,MPEGTS:1710000'),
      },
    ]);
    expect(cues.map((cue) => [cue.startMs, cue.sourceText])).toEqual([
      [1_000, '一番目'],
      [16_000, '二番目'],
    ]);
  });

  it('reads the origin from a caption-free leading segment', () => {
    const cues = cuesFromSegments([
      // Silent opening segment still establishes the presentation origin.
      { startMs: 0, text: 'WEBVTT\nX-TIMESTAMP-MAP=LOCAL:00:00:00.000,MPEGTS:810000\n\n' },
      {
        startMs: 10_000,
        text: segment('00:00:20.000 --> 00:00:21.000\n台詞', 'WEBVTT\nX-TIMESTAMP-MAP=LOCAL:00:00:00.000,MPEGTS:810000'),
      },
    ]);
    expect(cues[0]?.startMs).toBe(20_000);
  });

  it('throws a parse error when no segment yields a cue', () => {
    expect(() => cuesFromSegments([{ startMs: 0, text: 'WEBVTT\n\n' }])).toThrow(/No subtitle cues/);
  });
});
