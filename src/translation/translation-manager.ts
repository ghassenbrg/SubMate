import { sendCacheMessage } from '../cache/messages';
import type { CachedTranslation, SubtitleTrack, TranslationResult } from '../subtitles/models';
import { translationCacheKey } from '../subtitles/hashing';
import { validateTranslationResult } from '../subtitles/validation';
import type { TranslationProgress, TranslationProvider } from './provider';
import {
  WorkerTranslationCoordinator,
  type SharedProgress,
  type TranslationCoordinator,
} from './translation-coordinator';

/** How often a waiting tab checks on the tab doing the translation. */
export const SHARED_POLL_MS = 1_000;

export type SharedWaitListener = (progress: SharedProgress) => void;

const abortReason = (signal: AbortSignal) => signal.reason ?? new DOMException('Aborted', 'AbortError');

const pause = (ms: number, signal: AbortSignal) => new Promise<void>((resolve, reject) => {
  if (signal.aborted) return reject(abortReason(signal));
  const onAbort = () => {
    clearTimeout(timer);
    reject(abortReason(signal));
  };
  const timer = setTimeout(() => {
    signal.removeEventListener('abort', onAbort);
    resolve();
  }, ms);
  signal.addEventListener('abort', onAbort, { once: true });
});

export class TranslationManager {
  constructor(private readonly coordinator: TranslationCoordinator = new WorkerTranslationCoordinator()) {}

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

  /**
   * When another tab is already translating this exact entry, waits for it and
   * returns its result. Resolves undefined straight away when no tab is, and
   * also when the other tab stopped without saving a result.
   */
  async awaitShared(
    source: SubtitleTrack,
    targetLanguage: string,
    provider: TranslationProvider,
    onWaiting: SharedWaitListener,
    signal: AbortSignal,
  ): Promise<CachedTranslation | undefined> {
    const cacheKey = await translationCacheKey(source.sourceHash, targetLanguage, provider.id, provider.version);
    return this.waitForHolder(cacheKey, source, targetLanguage, provider, onWaiting, signal);
  }

  /**
   * Translates and caches, unless another tab is already doing the same job,
   * in which case this waits and reuses its result. If that tab gives up, this
   * one takes the job over.
   */
  async translate(
    source: SubtitleTrack,
    targetLanguage: string,
    provider: TranslationProvider,
    onProgress: (progress: TranslationProgress) => void,
    signal: AbortSignal,
    options: { onWaiting?: SharedWaitListener; reuseCached?: boolean } = {},
  ): Promise<CachedTranslation> {
    const cacheKey = await translationCacheKey(source.sourceHash, targetLanguage, provider.id, provider.version);
    const onWaiting = options.onWaiting ?? (() => undefined);
    let contended = false;
    for (;;) {
      if (signal.aborted) throw abortReason(signal);
      const lease = await this.coordinator.acquire(cacheKey);
      if (!lease) {
        contended = true;
        const shared = await this.waitForHolder(cacheKey, source, targetLanguage, provider, onWaiting, signal);
        if (shared) return shared;
        continue;
      }
      try {
        // Another tab may have finished between the caller's cache check and
        // this lease being granted. Even a forced retranslation reuses a result
        // that a contending tab has only just produced.
        if (options.reuseCached !== false || contended) {
          const cached = await this.findCached(source, targetLanguage, provider.id, provider.version);
          if (cached) return cached;
        }
        if (signal.aborted) throw abortReason(signal);
        const result = await provider.translate({
          sourceLanguage: source.sourceLanguage,
          targetLanguage,
          sourceHash: source.sourceHash,
          cues: source.cues.map((cue) => ({ id: cue.id, text: cue.sourceText })),
        }, (progress) => {
          lease.report(progress);
          onProgress(progress);
        }, signal);
        return await this.save(source, result);
      } finally {
        await lease.release();
      }
    }
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

  private async waitForHolder(
    cacheKey: string,
    source: SubtitleTrack,
    targetLanguage: string,
    provider: TranslationProvider,
    onWaiting: SharedWaitListener,
    signal: AbortSignal,
  ): Promise<CachedTranslation | undefined> {
    let progress = await this.coordinator.status(cacheKey);
    if (!progress) return undefined;
    while (progress) {
      if (signal.aborted) throw abortReason(signal);
      onWaiting(progress);
      await pause(SHARED_POLL_MS, signal);
      progress = await this.coordinator.status(cacheKey);
    }
    if (signal.aborted) throw abortReason(signal);
    return this.findCached(source, targetLanguage, provider.id, provider.version);
  }
}
