import { describe, expect, it } from 'vitest';
import { CueIndex } from '../../src/renderer/cue-index';

const index = new CueIndex([
  { id: 'one', startMs: 1000, endMs: 2000, sourceText: 'one' },
  { id: 'overlap', startMs: 1800, endMs: 2400, sourceText: 'overlap' },
  { id: 'three', startMs: 3000, endMs: 4000, sourceText: 'three' },
]);

describe('cue lookup', () => {
  it.each([
    [0, []], [1000, ['one']], [1500, ['one']], [1800, ['one', 'overlap']], [2000, ['one', 'overlap']],
    [2401, []], [2999, []], [3000, ['three']], [4000, ['three']], [4001, []],
  ])('finds active cues at %d ms', (time, expected) => expect(index.findAt(time).map((cue) => cue.id)).toEqual(expected));

  it('supports backwards seeking without retained state', () => {
    expect(index.findAt(3500)[0]?.id).toBe('three');
    expect(index.findAt(1200)[0]?.id).toBe('one');
  });

  it('recovers a cue from Netflix source text despite whitespace and clock differences', () => {
    const textIndex = new CueIndex([
      { id: 'early', startMs: 1_000, endMs: 2_000, sourceText: '同じ 台詞', translatedText: 'Early' },
      { id: 'near', startMs: 40_000, endMs: 45_000, sourceText: '同じ台詞', translatedText: 'Near' },
    ]);
    expect(textIndex.findBySourceText('同じ\n台詞', 44_000).map((cue) => cue.id)).toEqual(['near']);
  });
});
