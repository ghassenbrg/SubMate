import { describe, expect, it } from 'vitest';
import { chunkCues } from '../../src/translation/chunker';

describe('translation chunker', () => {
  const cues = Array.from({ length: 9 }, (_, index) => ({ id: `c${index}`, text: 'x'.repeat(index + 1) }));

  it('preserves order and never drops a cue', () => {
    const chunks = chunkCues(cues, { maxCues: 3, maxCharacters: 100 });
    expect(chunks.flat()).toEqual(cues);
    expect(chunks.every((chunk) => chunk.length <= 3)).toBe(true);
  });

  it('respects character limits except for an indivisible long cue', () => {
    const chunks = chunkCues(cues, { maxCues: 20, maxCharacters: 10 });
    expect(chunks.flat()).toEqual(cues);
    expect(chunks.filter((chunk) => chunk.length > 1).every((chunk) => chunk.reduce((sum, cue) => sum + cue.text.length, 0) <= 10)).toBe(true);
  });
});
