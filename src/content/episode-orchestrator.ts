import { sendCacheMessage } from '../cache/messages';
import { t, uiLocale } from '../i18n';
import { exportFileName, exportSource, importTranslation } from '../import-export/formats';
import { platformLabel } from '../platforms';
import type { AdapterHost, PlatformAdapter, SourceSelection } from '../platforms/types';
import { SubtitleOverlay } from '../renderer/subtitle-overlay';
import { SubMateError, friendlyError } from '../shared-errors';
import { loadSettings, saveSettings, watchSettings } from '../settings/store';
import type { SubMateSettings } from '../settings/schema';
import { hashSubtitle } from '../subtitles/hashing';
import type { SubMateViewState, SubtitleTrack, TranslationStatus } from '../subtitles/models';
import { countUntranslated, mergeTranslation, validateTranslationResult } from '../subtitles/validation';
import { ChromeTranslatorProvider } from '../translation/providers/chrome-translator';
import { TranslationManager } from '../translation/translation-manager';

export type EpisodeEventListener = (state: SubMateViewState) => void;

/**
 * Platform-independent orchestration of the subtitle pipeline.
 *
 * Everything here — discovery sequencing, caching, translation, validation,
 * rendering and cancellation — is expressed against `PlatformAdapter`. No
 * branch in this file depends on which streaming service is active.
 */
export class EpisodeOrchestrator implements AdapterHost {
  private settings!: SubMateSettings;
  private overlay!: SubtitleOverlay;
  private readonly provider = new ChromeTranslatorProvider();
  private readonly manager = new TranslationManager();
  private readonly listeners = new Set<EpisodeEventListener>();
  private source: SubtitleTrack | undefined;
  private rendered: SubtitleTrack | undefined;
  private video: HTMLVideoElement | undefined;
  private controller: AbortController | undefined;
  private generation = 0;
  private status: TranslationStatus = { state: 'idle' };
  private stopWatchingSettings: (() => void) | undefined;
  private contentId: string | undefined;

  constructor(private readonly adapter: PlatformAdapter) {}

  async initialize(): Promise<void> {
    this.settings = await loadSettings();
    this.overlay = new SubtitleOverlay(this.settings, {
      onActivate: () => void this.activate(),
      onRetry: () => void this.retry(),
      onDisplayMode: (displayMode) => void saveSettings({ displayMode }),
      onToggleEnabled: () => void saveSettings({ enabled: !this.settings.enabled }),
      onOpenSettings: () => void chrome.runtime.sendMessage({ type: 'OPEN_OPTIONS' }),
    });
    this.overlay.setPlaybackContext({
      isAdPlaying: () => this.adapter.isAdPlaying(),
      getNativeSubtitleText: () => this.adapter.getNativeSubtitleText?.() ?? '',
    });
    this.stopWatchingSettings = watchSettings((settings) => void this.applySettings(settings));
    this.setStatus(this.settings.enabled ? { state: 'idle' } : { state: 'disabled' });
    this.adapter.start(this);
    this.contentId = this.adapter.getContentId();
  }

  onState(listener: EpisodeEventListener): () => void {
    this.listeners.add(listener);
    listener(this.viewState());
    return () => this.listeners.delete(listener);
  }

  getState(): SubMateViewState {
    return this.viewState();
  }

  // --- AdapterHost ---------------------------------------------------------

  onVideoChanged(video: HTMLVideoElement | null): void {
    this.video = video ?? undefined;
    this.overlay.setPlayer(video);
    this.emit();
    if (!video || !this.settings.enabled || this.source) return;
    // A player appearing is the trigger to look for a translatable track. Only
    // a genuinely undecided ("pending") adapter falls back to the cache route;
    // a decided outcome such as "no captions" must be reported as itself.
    if (this.adapter.selectSource(this.settings).kind === 'pending') void this.restoreCachedRoute();
    else void this.prepare();
  }

  onContentChanged(contentId: string | undefined): void {
    if (contentId && contentId === this.contentId && this.source) return;
    this.contentId = contentId;
    this.cancel();
    this.source = undefined;
    this.rendered = undefined;
    this.overlay.setTrack(undefined);
    this.overlay.setLanguages(undefined, this.settings.preferredTargetLanguage);
    this.setStatus(this.settings.enabled ? { state: 'discovering' } : { state: 'disabled' });
    if (this.settings.enabled && this.video) void this.prepare();
  }

  onSourceAvailabilityChanged(): void {
    this.contentId = this.adapter.getContentId() ?? this.contentId;
    if (!this.settings.enabled) return;
    if (this.source) {
      // A late or newly hydrated manifest can promote a better source track for
      // the same content. Re-run the pipeline only when the chosen track really
      // changed, so ordinary manifest churn does not restart translation.
      const selection = this.adapter.selectSource(this.settings);
      if (selection.kind === 'ready' && selection.trackId !== this.source.trackId) {
        void this.prepare();
        return;
      }
      this.emit();
      return;
    }
    void this.prepare();
  }

  onAdStateChanged(adPlaying: boolean): void {
    // The overlay reads ad state through its injected context; this only needs
    // to refresh the reported view state and force an immediate repaint.
    this.overlay.setPlaybackContext({
      isAdPlaying: () => this.adapter.isAdPlaying(),
      getNativeSubtitleText: () => this.adapter.getNativeSubtitleText?.() ?? '',
    });
    this.debug(adPlaying ? 'ads: hiding translated subtitles' : 'ads: resuming translated subtitles');
    this.emit();
  }

  debug(message: string, detail?: unknown): void {
    if (!this.settings?.debugMode) return;
    const prefix = `[SubMate:${platformLabel(this.adapter.id)}]`;
    if (detail === undefined) console.info(prefix, message);
    else console.info(prefix, message, detail);
  }

  // --- User actions --------------------------------------------------------

  async activate(): Promise<void> {
    const source = this.source;
    const target = this.settings.preferredTargetLanguage;
    if (!source || this.status.state !== 'needs_user_activation') return;
    const generation = this.generation;
    try {
      await this.provider.activate(source.sourceLanguage, target, (progress) => {
        if (generation !== this.generation) return;
        this.setStatus({ state: 'downloading_model', progress: progress.progress });
      });
      if (generation !== this.generation) return;
      await this.translatePreparedSource(source, target, generation);
    } catch (error) {
      this.fail(error, generation);
    }
  }

  async retry(): Promise<void> {
    await this.prepare(true);
  }

  async importFile(
    input: string,
    fileName: string,
  ): Promise<{ matched: number; total: number; untranslated: number; targetLanguage: string }> {
    const source = this.source;
    if (!source) throw new SubMateError('IMPORT_INVALID_SCHEMA', 'No active source subtitle');
    const result = importTranslation(input, fileName, source, this.settings.preferredTargetLanguage);
    validateTranslationResult(source, result);
    await this.manager.save(source, result);
    this.rendered = mergeTranslation(source, result);
    this.overlay.setTrack(this.rendered);
    this.overlay.setLanguages(source.sourceLanguage, result.targetLanguage);
    this.setStatus({ state: 'ready', imported: true, progress: 1, completedCues: result.translations.length, totalCues: source.cues.length });
    if (result.targetLanguage !== this.settings.preferredTargetLanguage || this.settings.translationEngine !== 'manual') {
      await saveSettings({ preferredTargetLanguage: result.targetLanguage, translationEngine: 'manual' });
    }
    return {
      matched: result.translations.length,
      total: source.cues.length,
      // Blank lines are accepted, but the user should know they stay blank.
      untranslated: countUntranslated(source, result),
      targetLanguage: result.targetLanguage,
    };
  }

  exportCurrent(format: 'json' | 'srt' | 'vtt'): { content: string; fileName: string; mimeType: string } {
    if (!this.source) throw new SubMateError('IMPORT_INVALID_SCHEMA', 'No source subtitle is ready to export');
    return {
      content: exportSource(this.source, format),
      fileName: exportFileName(this.source, undefined, format),
      mimeType: format === 'json' ? 'application/json' : format === 'vtt' ? 'text/vtt' : 'application/x-subrip',
    };
  }

  destroy(): void {
    this.cancel();
    this.adapter.stop();
    this.stopWatchingSettings?.();
    this.provider.destroy();
    this.overlay.destroy();
  }

  getDebugInfo(): Record<string, unknown> {
    const nowMs = Math.floor((this.video?.currentTime ?? 0) * 1000);
    const activeCue = this.rendered?.cues.find((cue) => cue.startMs <= nowMs && cue.endMs >= nowMs);
    return {
      platform: this.adapter.id,
      capabilities: this.adapter.capabilities,
      contentId: this.contentId ?? null,
      sourceTrack: this.source?.trackId ?? null,
      sourceLanguage: this.source?.sourceLanguage ?? null,
      profile: this.source?.profile ?? null,
      cues: this.source?.cues.length ?? 0,
      sourceHash: this.source?.sourceHash ?? null,
      state: this.status.state,
      progress: this.status.progress ?? null,
      cacheHit: this.status.cacheHit ?? false,
      adPlaying: this.adapter.isAdPlaying(),
      videoTimeMs: nowMs,
      activeCue: activeCue?.id ?? null,
      ...(this.adapter.getDebugInfo?.() ?? {}),
    };
  }

  // --- Pipeline ------------------------------------------------------------

  private async prepare(force = false): Promise<void> {
    if (!this.settings.enabled || !this.video) {
      this.setStatus(this.settings.enabled ? { state: 'discovering' } : { state: 'disabled' });
      return;
    }
    const selection = this.adapter.selectSource(this.settings);
    if (!this.applyNonReadySelection(selection)) return;
    const ready = selection as Extract<SourceSelection, { kind: 'ready' }>;

    this.cancel();
    const controller = new AbortController();
    this.controller = controller;
    const generation = ++this.generation;
    const target = this.settings.preferredTargetLanguage;
    this.source = undefined;
    this.rendered = undefined;
    this.overlay.setTrack(undefined);
    this.setStatus({ state: 'discovering' });
    this.overlay.setLanguages(ready.language, target);
    const contentId = this.adapter.getContentId();
    if (!contentId) {
      this.setStatus({ state: 'discovering' });
      return;
    }
    this.contentId = contentId;

    try {
      this.setStatus({ state: 'downloading_source' });
      const extracted = await this.adapter.extractSource(ready, controller.signal);
      this.assertCurrent(generation);
      this.setStatus({ state: 'parsing_source' });
      const sourceHash = await hashSubtitle(extracted.language, extracted.cues);
      this.assertCurrent(generation);
      const source: SubtitleTrack = {
        platform: this.adapter.id,
        contentId,
        trackId: extracted.trackId,
        sourceLanguage: extracted.language,
        ...(extracted.label ? { label: extracted.label } : {}),
        kind: 'text',
        ...(extracted.profile ? { profile: extracted.profile } : {}),
        cues: extracted.cues,
        sourceHash,
      };
      this.source = source;
      this.debug('source track ready', { cues: source.cues.length, language: source.sourceLanguage });
      await sendCacheMessage<void>({ type: 'CACHE_PUT_SOURCE', track: source });
      this.assertCurrent(generation);
      this.setStatus({ state: 'checking_cache', totalCues: source.cues.length });
      if (!force) {
        const cached = this.settings.translationEngine === 'manual'
          ? await this.manager.findCached(source, target, 'manual', '1')
          : await this.manager.findForSelectedEngine(source, target, this.provider);
        this.assertCurrent(generation);
        if (cached) {
          this.debug('translation cache hit', { target });
          this.rendered = mergeTranslation(source, cached);
          this.overlay.setTrack(this.rendered);
          this.setStatus({ state: 'ready', cacheHit: true, progress: 1, completedCues: source.cues.length, totalCues: source.cues.length, imported: cached.engine.id === 'manual' });
          return;
        }
      }
      if (this.settings.translationEngine === 'manual') {
        this.setStatus({ state: 'idle', message: t('statusReady'), totalCues: source.cues.length });
        return;
      }
      if (!this.settings.autoTranslate) {
        this.setStatus({ state: 'needs_user_activation', message: t('overlayReadyToTranslate'), totalCues: source.cues.length });
        return;
      }
      const availability = await this.provider.availability(source.sourceLanguage, target);
      this.assertCurrent(generation);
      if (availability === 'unavailable') {
        throw new SubMateError('LANGUAGE_PAIR_UNSUPPORTED', 'Chrome does not support this language pair');
      }
      if (this.provider.needsActivation(source.sourceLanguage, target)) {
        this.setStatus({ state: 'needs_user_activation', totalCues: source.cues.length });
        return;
      }
      await this.translatePreparedSource(source, target, generation);
    } catch (error) {
      this.fail(error, generation);
    }
  }

  /** Maps a non-`ready` selection onto a status. Returns true to continue. */
  private applyNonReadySelection(selection: SourceSelection): boolean {
    switch (selection.kind) {
      case 'ready':
        return true;
      case 'pending':
        this.setStatus({ state: 'discovering' });
        return false;
      case 'target-available':
        this.setStatus({ state: 'target_available' });
        return false;
      case 'image-only':
        this.setStatus({ state: 'unsupported_image_track' });
        return false;
      case 'none':
        this.setStatus({ state: 'no_text_track', errorCode: 'NO_TEXT_SUBTITLE_TRACK' });
        return false;
    }
  }

  private async restoreCachedRoute(): Promise<void> {
    const contentId = this.adapter.getContentId();
    if (!contentId || !this.video || this.source) return;
    const generation = this.generation;
    const platform = this.adapter.id;
    this.setStatus({ state: 'checking_cache' });
    try {
      const source = await sendCacheMessage<SubtitleTrack | undefined>({
        type: 'CACHE_GET_CONTENT_SOURCE',
        contentId: `${platform}:${contentId}`,
      });
      const stillCurrent = () =>
        generation === this.generation && !this.source && this.adapter.getContentId() === contentId;
      if (!stillCurrent()) return;
      if (!source || source.contentId !== contentId || source.platform !== platform) {
        this.setStatus({ state: 'discovering' });
        return;
      }
      const target = this.settings.preferredTargetLanguage;
      const cached = this.settings.translationEngine === 'manual'
        ? await this.manager.findCached(source, target, 'manual', '1')
        : await this.manager.findForSelectedEngine(source, target, this.provider);
      if (!stillCurrent()) return;
      if (!cached) {
        this.setStatus({ state: 'discovering' });
        return;
      }
      this.contentId = contentId;
      this.source = source;
      this.rendered = mergeTranslation(source, cached);
      this.overlay.setLanguages(source.sourceLanguage, target);
      this.overlay.setTrack(this.rendered);
      this.debug('restored cached episode', { contentId, cues: source.cues.length });
      this.setStatus({
        state: 'ready',
        cacheHit: true,
        imported: cached.engine.id === 'manual',
        progress: 1,
        completedCues: source.cues.length,
        totalCues: source.cues.length,
      });
    } catch (error) {
      if (generation !== this.generation || this.source) return;
      this.debug('cached route restore failed', error);
      this.setStatus({ state: 'discovering' });
    }
  }

  private async translatePreparedSource(source: SubtitleTrack, target: string, generation: number): Promise<void> {
    const signal = this.controller?.signal ?? new AbortController().signal;
    const cached = await this.manager.translate(source, target, this.provider, (progress) => {
      if (generation !== this.generation) return;
      this.setStatus({
        state: progress.phase,
        progress: progress.progress,
        ...(progress.completedCues !== undefined ? { completedCues: progress.completedCues } : {}),
        ...(progress.totalCues !== undefined ? { totalCues: progress.totalCues } : {}),
      });
    }, signal);
    this.assertCurrent(generation);
    this.setStatus({ state: 'validating', totalCues: source.cues.length });
    validateTranslationResult(source, cached);
    this.rendered = mergeTranslation(source, cached);
    this.overlay.setTrack(this.rendered);
    this.setStatus({ state: 'ready', progress: 1, completedCues: source.cues.length, totalCues: source.cues.length });
  }

  private async applySettings(settings: SubMateSettings): Promise<void> {
    const old = this.settings;
    this.settings = settings;
    this.overlay.applySettings(settings);
    if (!settings.enabled) {
      this.cancel();
      this.overlay.setTrack(undefined);
      this.setStatus({ state: 'disabled' });
      return;
    }
    const pipelineChanged =
      !old.enabled ||
      old.preferredTargetLanguage !== settings.preferredTargetLanguage ||
      old.preferredSourceLanguage !== settings.preferredSourceLanguage ||
      old.translationEngine !== settings.translationEngine ||
      (!old.autoTranslate && settings.autoTranslate);
    if (!pipelineChanged) {
      this.emit();
      return;
    }
    if (this.adapter.selectSource(settings).kind !== 'pending') {
      await this.prepare();
      return;
    }
    // A late-start reload can be running entirely from the content-id cache. A
    // target or engine change must never leave that old translation visible.
    this.cancel();
    this.source = undefined;
    this.rendered = undefined;
    this.overlay.setTrack(undefined);
    await this.restoreCachedRoute();
  }

  private cancel(): void {
    this.controller?.abort(new DOMException('Episode changed', 'AbortError'));
    this.controller = undefined;
    this.generation += 1;
  }

  private assertCurrent(generation: number): void {
    if (generation !== this.generation) throw new DOMException('Obsolete episode job', 'AbortError');
  }

  private fail(error: unknown, generation: number): void {
    if (generation !== this.generation || (error instanceof DOMException && error.name === 'AbortError')) return;
    const code = error instanceof SubMateError ? error.code : 'TRANSLATION_FAILED';
    // "No captions for this episode" is an ordinary outcome, not a failure.
    if (code === 'NO_TEXT_SUBTITLE_TRACK') {
      this.setStatus({ state: 'no_text_track', errorCode: code });
      return;
    }
    this.setStatus({ state: 'failed', errorCode: code, message: friendlyError(code) });
    if (this.settings.debugMode) console.error(`[SubMate:${platformLabel(this.adapter.id)}]`, error);
  }

  private setStatus(status: TranslationStatus): void {
    this.status = status;
    this.overlay.setStatus(status);
    this.emit();
  }

  private emit(): void {
    const state = this.viewState();
    for (const listener of this.listeners) listener(state);
  }

  private viewState(): SubMateViewState {
    const contentId = this.contentId ?? this.source?.contentId;
    const selection = this.source ? undefined : this.adapter.selectSource(this.settings);
    const sourceLanguage = this.source?.sourceLanguage
      ?? (selection?.kind === 'ready' ? selection.language : undefined);
    return {
      enabled: this.settings.enabled,
      platform: this.adapter.id,
      adPlaying: this.adapter.isAdPlaying(),
      contentDetected: Boolean(contentId),
      hasPlayer: Boolean(this.video),
      ...(contentId ? { contentId } : {}),
      ...(sourceLanguage ? { sourceLanguage, sourceLanguageLabel: languageName(sourceLanguage) } : {}),
      targetLanguage: this.settings.preferredTargetLanguage,
      targetLanguageLabel: languageName(this.settings.preferredTargetLanguage),
      engine: this.settings.translationEngine,
      displayMode: this.settings.displayMode,
      status: this.status,
      ...(this.source ? { sourceCueCount: this.source.cues.length } : {}),
    };
  }
}

const languageName = (tag: string): string => {
  try { return new Intl.DisplayNames([uiLocale()], { type: 'language' }).of(tag) ?? tag; }
  catch { return tag; }
};
