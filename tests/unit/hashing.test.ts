import { describe, expect, it } from 'vitest';
import { hashSubtitle, translationCacheKey } from '../../src/subtitles/hashing';
import type { SubtitleCue } from '../../src/subtitles/models';

const cue = (patch: Partial<SubtitleCue> = {}): SubtitleCue => ({ id: 'c000001', startMs: 100, endMs: 200, sourceText: 'Hello world', ...patch });

describe('source and cache hashes', () => {
  it('is deterministic and normalizes harmless whitespace', async () => {
    expect(await hashSubtitle('de', [cue()])).toBe(await hashSubtitle('de', [cue()]));
    expect(await hashSubtitle('de', [cue({ sourceText: ' Hello   world ' })])).toBe(await hashSubtitle('de', [cue()]));
  });

  it('changes for text, timing, source language, and cue identity changes', async () => {
    const base = await hashSubtitle('de', [cue()]);
    await expect(hashSubtitle('de', [cue({ sourceText: 'Hallo' })])).resolves.not.toBe(base);
    await expect(hashSubtitle('de', [cue({ startMs: 101 })])).resolves.not.toBe(base);
    await expect(hashSubtitle('fr', [cue()])).resolves.not.toBe(base);
    await expect(hashSubtitle('de', [cue({ id: 'other' })])).resolves.not.toBe(base);
  });

  it('isolates cache entries by target, provider, and provider version', async () => {
    const key = await translationCacheKey('sha256:source', 'fr', 'chrome-local', '1');
    await expect(translationCacheKey('sha256:other', 'fr', 'chrome-local', '1')).resolves.not.toBe(key);
    await expect(translationCacheKey('sha256:source', 'ar', 'chrome-local', '1')).resolves.not.toBe(key);
    await expect(translationCacheKey('sha256:source', 'fr', 'manual', '1')).resolves.not.toBe(key);
    await expect(translationCacheKey('sha256:source', 'fr', 'chrome-local', '2')).resolves.not.toBe(key);
  });
});
