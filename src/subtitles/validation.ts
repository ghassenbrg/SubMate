import { FlixTranslateError } from '../shared-errors';
import type { SubtitleTrack, TranslationResult } from './models';

export function validateTranslationResult(source: SubtitleTrack, result: TranslationResult): void {
  if (result.sourceHash !== source.sourceHash || result.sourceLanguage !== source.sourceLanguage) {
    throw new FlixTranslateError('TRANSLATION_ID_MISMATCH', 'Translation source identity mismatch');
  }
  const sourceIds = new Set(source.cues.map((cue) => cue.id));
  const sourceById = new Map(source.cues.map((cue) => [cue.id, cue]));
  const translatedIds = new Set<string>();
  for (const translation of result.translations) {
    if (typeof translation.id !== 'string' || typeof translation.text !== 'string') {
      throw new FlixTranslateError('TRANSLATION_ID_MISMATCH', 'Translation entry is malformed');
    }
    if (translatedIds.has(translation.id) || !sourceIds.has(translation.id)) {
      throw new FlixTranslateError('TRANSLATION_ID_MISMATCH', 'Duplicate or unknown translation cue ID');
    }
    if (sourceById.get(translation.id)?.sourceText.trim() && !translation.text.trim()) {
      throw new FlixTranslateError('TRANSLATION_INCOMPLETE', 'A non-empty source cue has an empty translation');
    }
    translatedIds.add(translation.id);
  }
  if (translatedIds.size !== sourceIds.size) {
    throw new FlixTranslateError('TRANSLATION_INCOMPLETE', 'Translation does not cover every source cue');
  }
}

export function mergeTranslation(source: SubtitleTrack, result: TranslationResult): SubtitleTrack {
  validateTranslationResult(source, result);
  const byId = new Map(result.translations.map((item) => [item.id, item.text]));
  return {
    ...source,
    cues: source.cues.map((cue) => ({ ...cue, translatedText: byId.get(cue.id) ?? '' })),
  };
}
