import { sendCacheMessage } from '../cache/messages';
import type { CachedTranslation, SubtitleTrack, TranslationResult } from '../subtitles/models';
import { translationCacheKey } from '../subtitles/hashing';
import { validateTranslationResult } from '../subtitles/validation';
import type { TranslationProgress, TranslationProvider } from './provider';

export class TranslationManager {
  async findCached(
    source: SubtitleTrack,
    targetLanguage: string,
    engineId: string,
    engineVersion: string,
  ): Promise<CachedTranslation | undefined> {
    const key = await translationCacheKey(source.sourceHash, targetLanguage, engineId, engineVersion);
    const record = await sendCacheMessage<CachedTranslation | undefined>({ type: 'CACHE_GET_TRANSLATION', cacheKey: key });
    if (record) validateTranslationResult(source, record);
    return record;
  }

  async findForSelectedEngine(
    source: SubtitleTrack,
    targetLanguage: string,
    provider: TranslationProvider,
  ): Promise<CachedTranslation | undefined> {
    return (
      (await this.findCached(source, targetLanguage, provider.id, provider.version)) ??
      (await this.findCached(source, targetLanguage, 'manual', '1'))
    );
  }

  async translate(
    source: SubtitleTrack,
    targetLanguage: string,
    provider: TranslationProvider,
    onProgress: (progress: TranslationProgress) => void,
    signal: AbortSignal,
  ): Promise<CachedTranslation> {
    const result = await provider.translate({
      sourceLanguage: source.sourceLanguage,
      targetLanguage,
      sourceHash: source.sourceHash,
      cues: source.cues.map((cue) => ({ id: cue.id, text: cue.sourceText })),
    }, onProgress, signal);
    return this.save(source, result);
  }

  async save(source: SubtitleTrack, result: TranslationResult): Promise<CachedTranslation> {
    validateTranslationResult(source, result);
    const now = Date.now();
    const record: CachedTranslation = {
      ...result,
      cacheKey: await translationCacheKey(result.sourceHash, result.targetLanguage, result.engine.id, result.engine.version),
      createdAt: now,
      lastUsedAt: now,
    };
    await sendCacheMessage<void>({ type: 'CACHE_PUT_TRANSLATION', record });
    return record;
  }
}
