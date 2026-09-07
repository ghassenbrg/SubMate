import { sendCacheMessage } from '../cache/messages';
import { t, uiLocale } from '../i18n';
import { exportFileName, exportSource, importTranslation } from '../import-export/formats';
import { chooseSourceTrack, chooseTextDownload } from '../netflix/manifest-parser';
import type { NetflixManifestSnapshot } from '../netflix/netflix-types';
import { SubtitleOverlay } from '../renderer/subtitle-overlay';
import { FlixTranslateError, friendlyError } from '../shared-errors';
import { loadSettings, saveSettings, watchSettings } from '../settings/store';
import type { FlixTranslateSettings } from '../settings/schema';
import { hashSubtitle } from '../subtitles/hashing';
import type { FlixTranslateViewState, SubtitleTrack, TranslationStatus } from '../subtitles/models';
import { parseSubtitle } from '../subtitles/parser';
import { mergeTranslation, validateTranslationResult } from '../subtitles/validation';
import { ChromeTranslatorProvider } from '../translation/providers/chrome-translator';
import { TranslationManager } from '../translation/translation-manager';
import { requestPageSubtitle } from './message-bridge';

export type EpisodeEventListener = (state: FlixTranslateViewState) => void;

export class EpisodeOrchestrator {
  private settings!: FlixTranslateSettings;
  private overlay!: SubtitleOverlay;
  private readonly provider = new ChromeTranslatorProvider();
  private readonly manager = new TranslationManager();
  private readonly listeners = new Set<EpisodeEventListener>();
  private snapshot: NetflixManifestSnapshot | undefined;
  private source: SubtitleTrack | undefined;
  private rendered: SubtitleTrack | undefined;
  private video: HTMLVideoElement | undefined;
  private controller: AbortController | undefined;
  private generation = 0;
  private status: TranslationStatus = { state: 'idle' };
  private stopWatchingSettings: (() => void) | undefined;

  async initialize(): Promise<void> {
    this.settings = await loadSettings();
    this.overlay = new SubtitleOverlay(this.settings, {
      onActivate: () => void this.activate(),
      onRetry: () => void this.retry(),
      onDisplayMode: (displayMode) => void saveSettings({ displayMode }),
      onToggleEnabled: () => void saveSettings({ enabled: !this.settings.enabled }),
      onOpenSettings: () => void chrome.runtime.sendMessage({ type: 'OPEN_OPTIONS' }),
    });
    this.stopWatchingSettings = watchSettings((settings) => void this.applySettings(settings));
    this.setStatus(this.settings.enabled ? { state: 'idle' } : { state: 'disabled' });
  }

  onState(listener: EpisodeEventListener): () => void {
    this.listeners.add(listener);
    listener(this.viewState());
    return () => this.listeners.delete(listener);
  }

  getState(): FlixTranslateViewState {
    return this.viewState();
  }

  setPlayer(video: HTMLVideoElement | null): void {
    this.video = video ?? undefined;
    this.overlay.setPlayer(video);
    this.emit();
    if (video && this.snapshot && this.settings.enabled && !this.source) void this.prepare(this.snapshot);
    else if (video && !this.snapshot && this.settings.enabled && !this.source) void this.restoreCachedRoute();
  }

  handleNavigation(contentId?: string): void {
    if (contentId && contentId === (this.snapshot?.contentId ?? this.source?.contentId)) return;
    this.cancel();
    this.snapshot = undefined;
    this.source = undefined;
    this.rendered = undefined;
    this.overlay.setTrack(undefined);
    this.overlay.setLanguages(undefined, this.settings.preferredTargetLanguage);
    this.setStatus(this.settings.enabled ? { state: 'discovering' } : { state: 'disabled' });
  }

  handleManifest(snapshot: NetflixManifestSnapshot): void {
    const pathId = /^\/watch\/(\d+)/.exec(location.pathname)?.[1];
    if (!pathId || pathId !== snapshot.contentId) return; // Ignore Netflix hover/preload manifests.
    const isNewContent = snapshot.contentId !== this.snapshot?.contentId;
    const oldSourceChoice = this.snapshot
      ? chooseSourceTrack(this.snapshot, this.settings.preferredTargetLanguage, this.settings.preferredSourceLanguage).source?.trackId
      : undefined;
    const newSourceChoice = chooseSourceTrack(snapshot, this.settings.preferredTargetLanguage, this.settings.preferredSourceLanguage).source?.trackId;
    this.snapshot = snapshot;
    if (isNewContent || newSourceChoice !== oldSourceChoice || !this.source) void this.prepare(snapshot);
    else this.emit();
  }

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
    if (this.snapshot) await this.prepare(this.snapshot, true);
  }

  async importFile(input: string, fileName: string): Promise<{ matched: number; total: number; targetLanguage: string }> {
    const source = this.source;
    if (!source) throw new FlixTranslateError('IMPORT_INVALID_SCHEMA', 'No active source subtitle');
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
    return { matched: result.translations.length, total: source.cues.length, targetLanguage: result.targetLanguage };
  }

  exportCurrent(format: 'json' | 'srt' | 'vtt'): { content: string; fileName: string; mimeType: string } {
    if (!this.source) throw new FlixTranslateError('IMPORT_INVALID_SCHEMA', 'No source subtitle is ready to export');
    return {
      content: exportSource(this.source, format),
      fileName: exportFileName(this.source, undefined, format),
      mimeType: format === 'json' ? 'application/json' : format === 'vtt' ? 'text/vtt' : 'application/x-subrip',
    };
  }

  destroy(): void {
    this.cancel();
    this.stopWatchingSettings?.();
    this.provider.destroy();
    this.overlay.destroy();
  }

  getDebugInfo(): Record<string, unknown> {
    const nowMs = Math.floor((this.video?.currentTime ?? 0) * 1000);
    const activeCue = this.rendered?.cues.find((cue) => cue.startMs <= nowMs && cue.endMs >= nowMs);
    return {
      contentId: this.snapshot?.contentId ?? null,
      sourceTrack: this.source?.trackId ?? null,
      sourceLanguage: this.source?.sourceLanguage ?? null,
      profile: this.source?.profile ?? null,
      cues: this.source?.cues.length ?? 0,
      sourceHash: this.source?.sourceHash ?? null,
      state: this.status.state,
      progress: this.status.progress ?? null,
      cacheHit: this.status.cacheHit ?? false,
      videoTimeMs: nowMs,
      activeCue: activeCue?.id ?? null,
    };
  }

  private async prepare(snapshot: NetflixManifestSnapshot, force = false): Promise<void> {
    if (!this.settings.enabled || !this.video) {
      this.setStatus(this.settings.enabled ? { state: 'discovering' } : { state: 'disabled' });
      return;
    }
    this.cancel();
    const controller = new AbortController();
    this.controller = controller;
    const generation = ++this.generation;
    const target = this.settings.preferredTargetLanguage;
    this.source = undefined;
    this.rendered = undefined;
    this.overlay.setTrack(undefined);
    this.setStatus({ state: 'discovering' });
    const choice = chooseSourceTrack(snapshot, target, this.settings.preferredSourceLanguage);
    if (choice.targetAlreadyAvailable) {
      this.setStatus({ state: 'target_available' });
      return;
    }
    if (!choice.source) {
      this.setStatus(choice.imageOnly
        ? { state: 'unsupported_image_track' }
        : { state: 'no_text_track', errorCode: 'NO_TEXT_SUBTITLE_TRACK' });
      return;
    }
    const download = chooseTextDownload(choice.source);
    if (!download) {
      this.setStatus({ state: 'no_text_track', errorCode: 'NO_TEXT_SUBTITLE_TRACK' });
      return;
    }
    this.overlay.setLanguages(choice.source.language, target);
    try {
      this.setStatus({ state: 'downloading_source' });
      const raw = await requestPageSubtitle(snapshot.contentId, choice.source.trackId, download.profile, controller.signal);
      this.assertCurrent(generation);
      this.setStatus({ state: 'parsing_source' });
      const cues = parseSubtitle(raw.text, download.profile, raw.contentType);
      const sourceHash = await hashSubtitle(choice.source.language, cues);
      this.assertCurrent(generation);
      const source: SubtitleTrack = {
        platform: 'netflix',
        contentId: snapshot.contentId,
        trackId: choice.source.trackId,
        sourceLanguage: choice.source.language,
        label: choice.source.label,
        kind: 'text',
        profile: download.profile,
        cues,
        sourceHash,
      };
      this.source = source;
      await sendCacheMessage<void>({ type: 'CACHE_PUT_SOURCE', track: source });
      this.assertCurrent(generation);
      this.setStatus({ state: 'checking_cache', totalCues: cues.length });
      if (!force) {
        const cached = this.settings.translationEngine === 'manual'
          ? await this.manager.findCached(source, target, 'manual', '1')
          : await this.manager.findForSelectedEngine(source, target, this.provider);
        this.assertCurrent(generation);
        if (cached) {
          this.rendered = mergeTranslation(source, cached);
          this.overlay.setTrack(this.rendered);
          this.setStatus({ state: 'ready', cacheHit: true, progress: 1, completedCues: cues.length, totalCues: cues.length, imported: cached.engine.id === 'manual' });
          return;
        }
      }
      if (this.settings.translationEngine === 'manual') {
        this.setStatus({ state: 'idle', message: t('statusReady'), totalCues: cues.length });
        return;
      }
      if (!this.settings.autoTranslate) {
        this.setStatus({ state: 'needs_user_activation', message: t('overlayReadyToTranslate'), totalCues: cues.length });
        return;
      }
      const availability = await this.provider.availability(source.sourceLanguage, target);
      this.assertCurrent(generation);
      if (availability === 'unavailable') throw new FlixTranslateError('LANGUAGE_PAIR_UNSUPPORTED', 'Chrome does not support this language pair');
      if (this.provider.needsActivation(source.sourceLanguage, target)) {
        this.setStatus({ state: 'needs_user_activation', totalCues: cues.length });
        return;
      }
      await this.translatePreparedSource(source, target, generation);
    } catch (error) {
      this.fail(error, generation);
    }
  }

  private async restoreCachedRoute(): Promise<void> {
    const contentId = /^\/watch\/(\d+)/.exec(location.pathname)?.[1];
    if (!contentId || !this.video || this.snapshot || this.source) return;
    const generation = this.generation;
    this.setStatus({ state: 'checking_cache' });
    try {
      const source = await sendCacheMessage<SubtitleTrack | undefined>({ type: 'CACHE_GET_CONTENT_SOURCE', contentId });
      if (generation !== this.generation || this.snapshot || this.source || location.pathname !== `/watch/${contentId}`) return;
      if (!source || source.contentId !== contentId) {
        this.setStatus({ state: 'discovering' });
        return;
      }
      const target = this.settings.preferredTargetLanguage;
      const cached = this.settings.translationEngine === 'manual'
        ? await this.manager.findCached(source, target, 'manual', '1')
        : await this.manager.findForSelectedEngine(source, target, this.provider);
      if (generation !== this.generation || this.snapshot || this.source || location.pathname !== `/watch/${contentId}`) return;
      if (!cached) {
        this.setStatus({ state: 'discovering' });
        return;
      }
      this.source = source;
      this.rendered = mergeTranslation(source, cached);
      this.overlay.setLanguages(source.sourceLanguage, target);
      this.overlay.setTrack(this.rendered);
      this.setStatus({
        state: 'ready',
        cacheHit: true,
        imported: cached.engine.id === 'manual',
        progress: 1,
        completedCues: source.cues.length,
        totalCues: source.cues.length,
      });
    } catch (error) {
      if (generation !== this.generation || this.snapshot || this.source) return;
      if (this.settings.debugMode) console.warn('[FlixTranslate] Cached route restore failed', error);
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

  private async applySettings(settings: FlixTranslateSettings): Promise<void> {
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
    if (pipelineChanged && this.snapshot) {
      await this.prepare(this.snapshot);
    } else if (pipelineChanged && this.source) {
      // A late-start reload can be running entirely from content-ID cache. A
      // target/engine change must never leave that old translation visible.
      this.cancel();
      this.source = undefined;
      this.rendered = undefined;
      this.overlay.setTrack(undefined);
      await this.restoreCachedRoute();
    } else {
      this.emit();
    }
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
    const code = error instanceof FlixTranslateError ? error.code : 'TRANSLATION_FAILED';
    this.setStatus({ state: 'failed', errorCode: code, message: friendlyError(code) });
    if (this.settings.debugMode) console.error('[FlixTranslate]', error);
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

  private viewState(): FlixTranslateViewState {
    const contentId = this.snapshot?.contentId ?? this.source?.contentId;
    const sourceLanguage = this.source?.sourceLanguage ?? chooseSourceTrack(
      this.snapshot ?? { protocolVersion: 1, contentId: '', capturedAt: 0, tracks: [] },
      this.settings.preferredTargetLanguage,
      this.settings.preferredSourceLanguage,
    ).source?.language;
    return {
      enabled: this.settings.enabled,
      contentDetected: Boolean(this.snapshot || this.source),
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
