import type { TranslationRequest, TranslationResult } from '../subtitles/models';

export interface TranslationProgress {
  phase: 'downloading_model' | 'translating';
  progress: number;
  completedCues?: number;
  totalCues?: number;
}

export interface TranslationProvider {
  readonly id: string;
  readonly version: string;
  availability(sourceLanguage: string, targetLanguage: string): Promise<'available' | 'downloadable' | 'unavailable'>;
  needsActivation(sourceLanguage: string, targetLanguage: string): boolean;
  activate(sourceLanguage: string, targetLanguage: string, onProgress?: (progress: TranslationProgress) => void): Promise<void>;
  translate(
    input: TranslationRequest,
    onProgress?: (progress: TranslationProgress) => void,
    signal?: AbortSignal,
  ): Promise<TranslationResult>;
  destroy(): void;
}
