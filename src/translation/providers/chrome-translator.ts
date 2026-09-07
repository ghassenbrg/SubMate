import { FlixTranslateError } from '../../shared-errors';
import type { TranslationRequest, TranslationResult } from '../../subtitles/models';
import { chunkCues } from '../chunker';
import type { TranslationProgress, TranslationProvider } from '../provider';

interface ChromeTranslatorInstance {
  translate(input: string, options?: { signal?: AbortSignal }): Promise<string>;
  destroy(): void;
}

interface ChromeTranslatorMonitor {
  addEventListener(type: 'downloadprogress', listener: (event: Event & { loaded: number }) => void): void;
}

interface ChromeTranslatorApi {
  availability(options: { sourceLanguage: string; targetLanguage: string }): Promise<string>;
  create(options: {
    sourceLanguage: string;
    targetLanguage: string;
    monitor?: (monitor: ChromeTranslatorMonitor) => void;
  }): Promise<ChromeTranslatorInstance>;
}

const translatorApi = (): ChromeTranslatorApi | undefined =>
  (globalThis as typeof globalThis & { Translator?: ChromeTranslatorApi }).Translator;

export class ChromeTranslatorProvider implements TranslationProvider {
  readonly id = 'chrome-local';
  readonly version = 'translator-api-v1';
  private session: ChromeTranslatorInstance | undefined;
  private pair: string | undefined;

  async availability(sourceLanguage: string, targetLanguage: string): Promise<'available' | 'downloadable' | 'unavailable'> {
    const api = translatorApi();
    if (!api) return 'unavailable';
    try {
      const state = await api.availability({ sourceLanguage, targetLanguage });
      if (state === 'available') return 'available';
      if (state === 'downloadable' || state === 'downloading') return 'downloadable';
      return 'unavailable';
    } catch {
      return 'unavailable';
    }
  }

  needsActivation(sourceLanguage: string, targetLanguage: string): boolean {
    return !this.session || this.pair !== `${sourceLanguage}|${targetLanguage}`;
  }

  async activate(
    sourceLanguage: string,
    targetLanguage: string,
    onProgress?: (progress: TranslationProgress) => void,
  ): Promise<void> {
    const api = translatorApi();
    if (!api) throw new FlixTranslateError('TRANSLATOR_UNAVAILABLE', 'Translator API is not exposed in this document');
    if (this.session && this.pair === `${sourceLanguage}|${targetLanguage}`) return;
    this.destroy();
    // Deliberately call create synchronously in the activation event before awaiting.
    let creation: Promise<ChromeTranslatorInstance>;
    try {
      creation = api.create({
        sourceLanguage,
        targetLanguage,
        monitor(monitor) {
          monitor.addEventListener('downloadprogress', (event) => {
            onProgress?.({ phase: 'downloading_model', progress: Math.min(1, Math.max(0, event.loaded)) });
          });
        },
      });
    } catch (error) {
      throw new FlixTranslateError('TRANSLATOR_NEEDS_ACTIVATION', 'Chrome rejected translator creation', { cause: error });
    }
    try {
      this.session = await creation;
      this.pair = `${sourceLanguage}|${targetLanguage}`;
    } catch (error) {
      throw new FlixTranslateError('TRANSLATOR_MODEL_DOWNLOAD_FAILED', 'Translator creation or model download failed', { cause: error });
    }
  }

  async translate(
    input: TranslationRequest,
    onProgress?: (progress: TranslationProgress) => void,
    signal?: AbortSignal,
  ): Promise<TranslationResult> {
    if (!this.session || this.pair !== `${input.sourceLanguage}|${input.targetLanguage}`) {
      throw new FlixTranslateError('TRANSLATOR_NEEDS_ACTIVATION', 'Translator session has not been activated');
    }
    const translations: Array<{ id: string; text: string }> = [];
    let complete = 0;
    for (const chunk of chunkCues(input.cues)) {
      for (const cue of chunk) {
        if (signal?.aborted) throw signal.reason ?? new DOMException('Aborted', 'AbortError');
        try {
          const text = cue.text ? await this.session.translate(cue.text, signal ? { signal } : {}) : '';
          translations.push({ id: cue.id, text });
        } catch (error) {
          if (signal?.aborted) throw error;
          throw new FlixTranslateError('TRANSLATION_FAILED', `Translation failed for cue ${cue.id}`, { cause: error });
        }
        complete += 1;
        onProgress?.({
          phase: 'translating',
          progress: input.cues.length ? complete / input.cues.length : 1,
          completedCues: complete,
          totalCues: input.cues.length,
        });
      }
    }
    return {
      sourceHash: input.sourceHash,
      sourceLanguage: input.sourceLanguage,
      targetLanguage: input.targetLanguage,
      engine: { id: this.id, version: this.version },
      translations,
    };
  }

  destroy(): void {
    this.session?.destroy();
    this.session = undefined;
    this.pair = undefined;
  }
}
