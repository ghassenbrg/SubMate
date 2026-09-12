import { describe, expect, it } from 'vitest';
import type { SubtitleTrack, TranslationResult } from '../../src/subtitles/models';
import { countUntranslated, mergeTranslation, validateTranslationResult } from '../../src/subtitles/validation';

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

  it('accepts a minority of blank lines, which translators leave for non-speech cues', () => {
    // A real 705-line import failed over 13 blank lines (music and sound-effect
    // cues). Rejecting a whole episode for those is worse than rendering them
    // blank, so a minority of empties is now tolerated.
    const track: SubtitleTrack = {
      ...sourceTrack(),
      cues: Array.from({ length: 100 }, (_, index) => ({
        id: `c${String(index + 1).padStart(6, '0')}`,
        startMs: index * 1_000,
        endMs: index * 1_000 + 900,
        sourceText: `line ${index + 1}`,
      })),
    };
    const translations = track.cues.map((cue, index) => ({ id: cue.id, text: index < 5 ? '' : 'translated' }));
    expect(() => validateTranslationResult(track, result(translations))).not.toThrow();
    expect(countUntranslated(track, result(translations))).toBe(5);
  });

  it('still rejects a file that is mostly empty', () => {
    const track: SubtitleTrack = {
      ...sourceTrack(),
      cues: Array.from({ length: 100 }, (_, index) => ({
        id: `c${String(index + 1).padStart(6, '0')}`,
        startMs: index * 1_000,
        endMs: index * 1_000 + 900,
        sourceText: `line ${index + 1}`,
      })),
    };
    const translations = track.cues.map((cue, index) => ({ id: cue.id, text: index < 60 ? '' : 'translated' }));
    expect(() => validateTranslationResult(track, result(translations))).toThrow(/no translation/);
  });

  it('never counts a blank source cue as untranslated', () => {
    const track: SubtitleTrack = {
      ...sourceTrack(),
      cues: [
        { id: 'c000001', startMs: 0, endMs: 900, sourceText: '' },
        { id: 'c000002', startMs: 1_000, endMs: 1_900, sourceText: 'Welt' },
      ],
    };
    const translations = [{ id: 'c000001', text: '' }, { id: 'c000002', text: 'World' }];
    expect(() => validateTranslationResult(track, result(translations))).not.toThrow();
    expect(countUntranslated(track, result(translations))).toBe(0);
  });

  it('reports how many lines are missing when coverage is incomplete', () => {
    expect(() => validateTranslationResult(sourceTrack(), result([{ id: 'c000001', text: 'Hello' }])))
      .toThrow(/1 of 2 lines/);
  });
});
