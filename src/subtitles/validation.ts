import { SubMateError } from '../shared-errors';
import type { SubtitleTrack, TranslationResult } from './models';

/**
 * Share of translatable lines that may come back empty before a file is treated
 * as broken rather than merely incomplete.
 *
 * Human and machine translators legitimately leave some cues blank — music
 * stings, sound effects and on-screen signs carry nothing to translate. Failing
 * a whole episode over a handful of those is far more disruptive than rendering
 * nothing for them, while a systematically empty file is still caught.
 */
export const EMPTY_TRANSLATION_TOLERANCE = 0.5;

export function validateTranslationResult(source: SubtitleTrack, result: TranslationResult): void {
  if (result.sourceHash !== source.sourceHash || result.sourceLanguage !== source.sourceLanguage) {
    throw new SubMateError('TRANSLATION_ID_MISMATCH', 'Translation source identity mismatch');
  }
  const sourceIds = new Set(source.cues.map((cue) => cue.id));
  const sourceById = new Map(source.cues.map((cue) => [cue.id, cue]));
  const translatedIds = new Set<string>();
  for (const translation of result.translations) {
    if (typeof translation.id !== 'string' || typeof translation.text !== 'string') {
      throw new SubMateError('TRANSLATION_ID_MISMATCH', 'Translation entry is malformed');
    }
    if (translatedIds.has(translation.id) || !sourceIds.has(translation.id)) {
      throw new SubMateError('TRANSLATION_ID_MISMATCH', 'Duplicate or unknown translation cue ID');
    }
    translatedIds.add(translation.id);
  }
  if (translatedIds.size !== sourceIds.size) {
    throw new SubMateError(
      'TRANSLATION_INCOMPLETE',
      `Translation covers ${translatedIds.size} of ${sourceIds.size} lines`,
    );
  }
  const untranslated = countUntranslated(source, result);
  const translatable = source.cues.filter((cue) => cue.sourceText.trim()).length;
  if (translatable && untranslated > translatable * EMPTY_TRANSLATION_TOLERANCE) {
    throw new SubMateError(
      'TRANSLATION_INCOMPLETE',
      `${untranslated} of ${translatable} lines have no translation`,
    );
  }
}

/** Lines that carry source text but came back with an empty translation. */
export function countUntranslated(source: SubtitleTrack, result: TranslationResult): number {
  const byId = new Map(result.translations.map((item) => [item.id, item.text]));
  return source.cues.filter((cue) => cue.sourceText.trim() && !(byId.get(cue.id) ?? '').trim()).length;
}

export function mergeTranslation(source: SubtitleTrack, result: TranslationResult): SubtitleTrack {
  validateTranslationResult(source, result);
  const byId = new Map(result.translations.map((item) => [item.id, item.text]));
  return {
    ...source,
    cues: source.cues.map((cue) => ({ ...cue, translatedText: byId.get(cue.id) ?? '' })),
  };
}
