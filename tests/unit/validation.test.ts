import { describe, expect, it } from 'vitest';
import type { SubtitleTrack, TranslationResult } from '../../src/subtitles/models';
import { mergeTranslation, validateTranslationResult } from '../../src/subtitles/validation';

export const sourceTrack = (): SubtitleTrack => ({
  platform: 'netflix', contentId: '123', trackId: 'track-de', sourceLanguage: 'de', kind: 'text', profile: 'dfxp-ls-sdh', sourceHash: 'sha256:source',
  cues: [
    { id: 'c000001', startMs: 1000, endMs: 2000, sourceText: 'Hallo' },
    { id: 'c000002', startMs: 3000, endMs: 4000, sourceText: 'Welt' },
  ],
});

const result = (translations = [{ id: 'c000001', text: 'Hello' }, { id: 'c000002', text: 'World' }]): TranslationResult => ({
  sourceHash: 'sha256:source', sourceLanguage: 'de', targetLanguage: 'en', engine: { id: 'fake', version: '1' }, translations,
});

describe('translation validation', () => {
  it('accepts an exact ID set and merges without touching timing', () => {
    validateTranslationResult(sourceTrack(), result());
    const merged = mergeTranslation(sourceTrack(), result());
    expect(merged.cues[0]).toEqual({ id: 'c000001', startMs: 1000, endMs: 2000, sourceText: 'Hallo', translatedText: 'Hello' });
  });

  it.each([
    ['missing', [{ id: 'c000001', text: 'Hello' }]],
    ['duplicate', [{ id: 'c000001', text: 'Hello' }, { id: 'c000001', text: 'Again' }]],
    ['unknown', [{ id: 'c000001', text: 'Hello' }, { id: 'unknown', text: 'World' }]],
  ])('rejects %s cue IDs', (_name, translations) => {
    expect(() => validateTranslationResult(sourceTrack(), result(translations))).toThrow();
  });

  it('rejects the wrong source hash or source language', () => {
    expect(() => validateTranslationResult(sourceTrack(), { ...result(), sourceHash: 'sha256:wrong' })).toThrow();
    expect(() => validateTranslationResult(sourceTrack(), { ...result(), sourceLanguage: 'fr' })).toThrow();
  });

  it('rejects an empty translation for a non-empty source cue', () => {
    expect(() => validateTranslationResult(sourceTrack(), result([
      { id: 'c000001', text: '' },
      { id: 'c000002', text: 'World' },
    ]))).toThrow();
  });
});
