export interface SubtitleCue {
  id: string;
  startMs: number;
  endMs: number;
  sourceText: string;
  translatedText?: string;
}

export interface SubtitleTrack {
  platform: 'netflix';
  contentId: string;
  trackId: string;
  sourceLanguage: string;
  label?: string;
  kind: 'text' | 'image' | 'unknown';
  profile?: string;
  cues: SubtitleCue[];
  sourceHash: string;
}

export interface TranslationRequest {
  sourceLanguage: string;
  targetLanguage: string;
  sourceHash: string;
  cues: Array<{ id: string; text: string }>;
}

export interface TranslationResult {
  sourceHash: string;
  sourceLanguage: string;
  targetLanguage: string;
  engine: { id: string; version: string };
  translations: Array<{ id: string; text: string }>;
}

export interface CachedTranslation extends TranslationResult {
  cacheKey: string;
  createdAt: number;
  lastUsedAt: number;
}

export type TranslationState =
  | 'idle'
  | 'disabled'
  | 'discovering'
  | 'downloading_source'
  | 'parsing_source'
  | 'checking_cache'
  | 'target_available'
  | 'needs_user_activation'
  | 'downloading_model'
  | 'translating'
  | 'validating'
  | 'ready'
  | 'unsupported_image_track'
  | 'no_text_track'
  | 'failed';

export interface TranslationStatus {
  state: TranslationState;
  progress?: number;
  completedCues?: number;
  totalCues?: number;
  message?: string;
  errorCode?: string;
  cacheHit?: boolean;
  imported?: boolean;
}

export interface FlixTranslateViewState {
  enabled: boolean;
  contentDetected: boolean;
  hasPlayer: boolean;
  contentId?: string;
  sourceLanguage?: string;
  sourceLanguageLabel?: string;
  targetLanguage: string;
  targetLanguageLabel: string;
  engine: 'chrome-local' | 'manual';
  displayMode: 'bilingual' | 'translation-only' | 'off';
  status: TranslationStatus;
  sourceCueCount?: number;
}
