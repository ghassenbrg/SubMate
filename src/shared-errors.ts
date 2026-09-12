export type SubMateErrorCode =
  | 'NETFLIX_MANIFEST_NOT_FOUND'
  | 'NO_PLAYER'
  | 'NO_MANIFEST'
  | 'SUBTITLE_MANIFEST_FAILED'
  | 'SUBTITLE_SEGMENT_FAILED'
  | 'UNSUPPORTED_PLAYER_STATE'
  | 'NO_SUBTITLE_TRACKS'
  | 'NO_TEXT_SUBTITLE_TRACK'
  | 'SUBTITLE_DOWNLOAD_FAILED'
  | 'SUBTITLE_PARSE_FAILED'
  | 'TRANSLATOR_UNAVAILABLE'
  | 'TRANSLATOR_NEEDS_ACTIVATION'
  | 'TRANSLATOR_MODEL_DOWNLOAD_FAILED'
  | 'LANGUAGE_PAIR_UNSUPPORTED'
  | 'TRANSLATION_FAILED'
  | 'TRANSLATION_ID_MISMATCH'
  | 'TRANSLATION_INCOMPLETE'
  | 'IMPORT_HASH_MISMATCH'
  | 'IMPORT_INVALID_SCHEMA'
  | 'IMPORT_AMBIGUOUS_ALIGNMENT'
  | 'RENDERER_PLAYER_NOT_FOUND';

export class SubMateError extends Error {
  constructor(
    public readonly code: SubMateErrorCode,
    message: string,
    options?: ErrorOptions,
  ) {
    super(message, options);
    this.name = 'SubMateError';
  }
}

export const friendlyError = (code?: string): string => {
  switch (code) {
    case 'NO_SUBTITLE_TRACKS':
    case 'NO_TEXT_SUBTITLE_TRACK':
      return t('statusNoTextTrack');
    case 'SUBTITLE_DOWNLOAD_FAILED':
    case 'SUBTITLE_MANIFEST_FAILED':
    case 'SUBTITLE_SEGMENT_FAILED':
      return t('errorDownload');
    case 'NO_PLAYER':
    case 'NO_MANIFEST':
    case 'UNSUPPORTED_PLAYER_STATE':
      return t('errorPlayerState');
    case 'SUBTITLE_PARSE_FAILED':
      return t('errorParse');
    case 'TRANSLATOR_UNAVAILABLE':
      return t('errorTranslatorUnavailable');
    case 'LANGUAGE_PAIR_UNSUPPORTED':
      return t('errorPairUnsupported');
    case 'TRANSLATOR_MODEL_DOWNLOAD_FAILED':
      return t('errorLanguageData');
    case 'IMPORT_HASH_MISMATCH':
      return t('errorWrongTrack');
    case 'IMPORT_AMBIGUOUS_ALIGNMENT':
      return t('errorAmbiguousImport');
    case 'IMPORT_INVALID_SCHEMA':
      return t('errorInvalidImport');
    case 'TRANSLATION_INCOMPLETE':
      return t('errorIncompleteTranslation');
    case 'TRANSLATION_ID_MISMATCH':
      return t('errorTranslationMismatch');
    default:
      return t('statusFailed');
  }
};
import { t } from './i18n';
