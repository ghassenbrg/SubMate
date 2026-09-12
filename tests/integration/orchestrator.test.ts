import { beforeEach, describe, expect, it, vi } from 'vitest';
import type {
  CachedTranslation,
  FlixTranslateViewState,
  SubtitleTrack,
  TranslationRequest,
  TranslationResult,
} from '../../src/subtitles/models';

const mocks = vi.hoisted(() => ({
  settings: {
    enabled: true, autoTranslate: true, preferredTargetLanguage: 'fr', translationEngine: 'chrome-local' as const,
    displayMode: 'bilingual' as const, translatedFontScale: 1, verticalPosition: .13, showPlayerStatus: true,
    onboardingComplete: true, debugMode: false,
  },
  cache: new Map<string, unknown>(),
  translationCalls: 0,
  holdNextTranslation: false,
  releaseTranslation: undefined as (() => void) | undefined,
  providerStartsActivated: true,
  watchCallback: undefined as ((settings: unknown) => void) | undefined,
  overlays: [] as Array<{
    track: SubtitleTrack | undefined;
    statuses: unknown[];
    languages: Array<[string | undefined, string | undefined]>;
    settingsApplied: unknown[];
  }>,
}));

vi.mock('../../src/cache/messages', () => ({
  sendCacheMessage: async (message: Record<string, unknown>) => {
    switch (message.type) {
      case 'CACHE_PUT_SOURCE': {
        const track = message.track as SubtitleTrack;
        mocks.cache.set(`source:${track.sourceHash}`, track);
        mocks.cache.set(`content:${track.platform}:${track.contentId}`, track);
        return undefined;
      }
      case 'CACHE_GET_CONTENT_SOURCE': return mocks.cache.get(`content:${message.contentId as string}`);
      case 'CACHE_GET_TRANSLATION': return mocks.cache.get(`translation:${message.cacheKey as string}`);
      case 'CACHE_PUT_TRANSLATION':
        mocks.cache.set(`translation:${(message.record as CachedTranslation).cacheKey}`, message.record);
        return undefined;
      default: return undefined;
    }
  },
}));

vi.mock('../../src/settings/store', () => ({
  loadSettings: async () => ({ ...mocks.settings }),
  saveSettings: async (patch: Record<string, unknown>) => Object.assign(mocks.settings, patch),
  watchSettings: (callback: (settings: unknown) => void) => {
    mocks.watchCallback = callback;
    return () => { mocks.watchCallback = undefined; };
  },
}));

vi.mock('../../src/renderer/subtitle-overlay', () => ({
  SubtitleOverlay: class {
    state = { track: undefined as SubtitleTrack | undefined, statuses: [] as unknown[], languages: [] as Array<[string | undefined, string | undefined]>, settingsApplied: [] as unknown[] };
    constructor() { mocks.overlays.push(this.state); }
    setPlayer() {}
    setPlaybackContext() {}
    setTrack(track?: SubtitleTrack) { this.state.track = track; }
    setLanguages(source?: string, target?: string) { this.state.languages.push([source, target]); }
    setStatus(status: unknown) { this.state.statuses.push(status); }
    applySettings(settings: unknown) { this.state.settingsApplied.push(settings); }
    destroy() {}
  },
}));

vi.mock('../../src/translation/providers/chrome-translator', () => ({
  ChromeTranslatorProvider: class {
    id = 'chrome-local'; version = 'translator-api-v1'; activated = mocks.providerStartsActivated;
    async availability() { return 'available' as const; }
    needsActivation() { return !this.activated; }
    async activate() { this.activated = true; }
    async translate(input: TranslationRequest, onProgress?: (event: unknown) => void, signal?: AbortSignal): Promise<TranslationResult> {
      mocks.translationCalls += 1;
      if (mocks.holdNextTranslation) {
        mocks.holdNextTranslation = false;
        await new Promise<void>((resolve) => { mocks.releaseTranslation = resolve; });
        if (signal?.aborted) throw signal.reason ?? new DOMException('Aborted', 'AbortError');
      }
      onProgress?.({ phase: 'translating', progress: 1, completedCues: input.cues.length, totalCues: input.cues.length });
      return {
        sourceHash: input.sourceHash, sourceLanguage: input.sourceLanguage, targetLanguage: input.targetLanguage,
        engine: { id: this.id, version: this.version },
        translations: input.cues.map((cue) => ({ id: cue.id, text: `${input.targetLanguage}→ ${cue.text}` })),
      };
    }
    destroy() {}
  },
}));

import { EpisodeOrchestrator } from '../../src/content/episode-orchestrator';
import type { AdapterHost, ExtractedSource, PlatformAdapter, SourceSelection } from '../../src/platforms/types';
import type { SubtitleCue } from '../../src/subtitles/models';

const cue = (text: string): SubtitleCue => ({ id: 'c000001', startMs: 1_000, endMs: 2_000, sourceText: text });

/**
 * A controllable stand-in for any streaming platform. Driving the orchestrator
 * through this proves the pipeline contains no platform-specific behaviour.
 */
class FakeAdapter implements PlatformAdapter {
  readonly id = 'netflix' as const;
  readonly capabilities = {
    supportsOriginalSubtitles: true, supportsFullEpisodeExtraction: true, supportsDualSubtitles: true,
    supportsEpisodeDetection: true, supportsAdDetection: true,
  };
  host: AdapterHost | undefined;
  contentId: string | undefined = '100';
  selection: SourceSelection = { kind: 'ready', trackId: 'T:de', language: 'de', profile: 'dfxp' };
  video: HTMLVideoElement | undefined;
  adPlaying = false;
  stopped = false;
  extractCalls: string[] = [];
  extractImpl: (contentId: string) => Promise<ExtractedSource> = async (contentId) => ({
    cues: [cue(contentId === '200' ? '안녕' : 'Hallo')],
    language: this.selection.kind === 'ready' ? this.selection.language : 'de',
    trackId: 'T:de',
  });

  matches() { return true; }
  start(host: AdapterHost) { this.host = host; }
  stop() { this.stopped = true; }
  getContentId() { return this.contentId; }
  selectSource() { return this.selection; }
  async extractSource(_selection: never, signal: AbortSignal): Promise<ExtractedSource> {
    const id = this.contentId ?? '';
    this.extractCalls.push(id);
    const result = await this.extractImpl(id);
    if (signal.aborted) throw signal.reason ?? new DOMException('Aborted', 'AbortError');
    return result;
  }
  getVideo() { return this.video; }
  isAdPlaying() { return this.adPlaying; }

  /** Simulates a player appearing. */
  attachVideo() {
    const video = document.createElement('video');
    Object.defineProperty(video, 'paused', { value: true });
    this.video = video;
    this.host?.onVideoChanged(video);
  }
  navigateTo(contentId: string, selection?: SourceSelection) {
    this.contentId = contentId;
    if (selection) this.selection = selection;
    this.host?.onContentChanged(contentId);
  }
}

async function startOrchestrator(adapter: FakeAdapter, attach = true) {
  const orchestrator = new EpisodeOrchestrator(adapter);
  await orchestrator.initialize();
  if (attach) adapter.attachVideo();
  return orchestrator;
}

beforeEach(() => {
  mocks.cache.clear();
  mocks.translationCalls = 0;
  mocks.overlays.length = 0;
  mocks.holdNextTranslation = false;
  mocks.releaseTranslation = undefined;
  mocks.providerStartsActivated = true;
  mocks.watchCallback = undefined;
  mocks.settings.enabled = true;
  mocks.settings.autoTranslate = true;
  mocks.settings.preferredTargetLanguage = 'fr';
  mocks.settings.translationEngine = 'chrome-local';
});

describe('episode orchestration', () => {
  it('extracts, hashes, translates, validates, renders, then serves an exact cache hit', async () => {
    const first = await startOrchestrator(new FakeAdapter());
    await vi.waitFor(() => expect(first.getState().status.state).toBe('ready'));
    expect(first.getState()).toMatchObject({ sourceLanguage: 'de', targetLanguage: 'fr', sourceCueCount: 1 });
    expect(mocks.overlays[0]?.track?.cues[0]?.translatedText).toBe('fr→ Hallo');
    expect(mocks.translationCalls).toBe(1);
    first.destroy();

    const second = await startOrchestrator(new FakeAdapter());
    await vi.waitFor(() => expect(second.getState().status.state).toBe('ready'));
    expect(second.getState().status.cacheHit).toBe(true);
    // A reload must not call the translation engine again.
    expect(mocks.translationCalls).toBe(1);
    second.destroy();
  });

  it('restores a cached episode when playback resumes without fresh discovery', async () => {
    const source: SubtitleTrack = {
      platform: 'netflix', contentId: '100', trackId: 'T:de', sourceLanguage: 'de', kind: 'text',
      cues: [{ id: 'cached-cue', startMs: 1_000, endMs: 2_000, sourceText: 'Hallo' }], sourceHash: 'cached-source',
    };
    mocks.cache.set('content:netflix:100', source);
    const manager = new (await import('../../src/translation/translation-manager')).TranslationManager();
    await manager.save(source, {
      sourceHash: source.sourceHash, sourceLanguage: 'de', targetLanguage: 'fr',
      engine: { id: 'chrome-local', version: 'translator-api-v1' },
      translations: [{ id: 'cached-cue', text: 'Bonjour' }],
    });

    const adapter = new FakeAdapter();
    adapter.selection = { kind: 'pending' };
    const orchestrator = await startOrchestrator(adapter);
    await vi.waitFor(() => expect(orchestrator.getState()).toMatchObject({
      contentDetected: true, contentId: '100', sourceLanguage: 'de', sourceCueCount: 1,
      status: { state: 'ready', cacheHit: true },
    }));
    expect(mocks.overlays[0]?.track?.cues[0]?.translatedText).toBe('Bonjour');
    expect(adapter.extractCalls).toEqual([]);
    expect(mocks.translationCalls).toBe(0);
    orchestrator.destroy();
  });

  it('prevents an obsolete episode job from rendering over the new episode', async () => {
    const adapter = new FakeAdapter();
    let resolveA!: (value: ExtractedSource) => void;
    adapter.extractImpl = (contentId) => contentId === '100'
      ? new Promise((resolve) => { resolveA = resolve; })
      : Promise.resolve({ cues: [cue('안녕')], language: 'ko', trackId: 'T:ko' });

    const states: FlixTranslateViewState[] = [];
    const orchestrator = await startOrchestrator(adapter);
    orchestrator.onState((state) => states.push(state));
    await vi.waitFor(() => expect(adapter.extractCalls).toEqual(['100']));

    adapter.navigateTo('200', { kind: 'ready', trackId: 'T:ko', language: 'ko' });
    await vi.waitFor(() => expect(orchestrator.getState().status.state).toBe('ready'));

    resolveA({ cues: [cue('STALE')], language: 'de', trackId: 'T:de' });
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(orchestrator.getState()).toMatchObject({ contentId: '200', sourceLanguage: 'ko', status: { state: 'ready' } });
    expect(mocks.overlays[0]?.track?.contentId).toBe('200');
    expect(mocks.overlays[0]?.track?.cues[0]?.sourceText).toBe('안녕');
    expect(states.some((state) => state.contentId === '200' && state.status.state === 'ready')).toBe(true);
    orchestrator.destroy();
  });

  it('maps each non-translatable selection to its own explicit state', async () => {
    for (const [selection, expected] of [
      [{ kind: 'target-available' }, 'target_available'],
      [{ kind: 'image-only' }, 'unsupported_image_track'],
      [{ kind: 'none' }, 'no_text_track'],
    ] as const) {
      const adapter = new FakeAdapter();
      adapter.selection = selection;
      const orchestrator = await startOrchestrator(adapter);
      await vi.waitFor(() => expect(orchestrator.getState().status.state).toBe(expected));
      expect(adapter.extractCalls).toEqual([]);
      expect(mocks.translationCalls).toBe(0);
      orchestrator.destroy();
    }
  });

  it('treats a missing caption track as an ordinary outcome, not a failure', async () => {
    const adapter = new FakeAdapter();
    adapter.extractImpl = async () => {
      const { FlixTranslateError } = await import('../../src/shared-errors');
      throw new FlixTranslateError('NO_TEXT_SUBTITLE_TRACK', 'This episode has no captions');
    };
    const orchestrator = await startOrchestrator(adapter);
    await vi.waitFor(() => expect(orchestrator.getState().status.state).toBe('no_text_track'));
    expect(orchestrator.getState().status.state).not.toBe('failed');
    orchestrator.destroy();
  });

  it('surfaces a genuine extraction failure as a retryable error', async () => {
    const adapter = new FakeAdapter();
    adapter.extractImpl = async () => {
      const { FlixTranslateError } = await import('../../src/shared-errors');
      throw new FlixTranslateError('SUBTITLE_SEGMENT_FAILED', 'network down');
    };
    const orchestrator = await startOrchestrator(adapter);
    await vi.waitFor(() => expect(orchestrator.getState().status.state).toBe('failed'));
    expect(orchestrator.getState().status.errorCode).toBe('SUBTITLE_SEGMENT_FAILED');

    // Retry after the transient failure clears must succeed.
    adapter.extractImpl = async () => ({ cues: [cue('Hallo')], language: 'de', trackId: 'T:de' });
    await orchestrator.retry();
    await vi.waitFor(() => expect(orchestrator.getState().status.state).toBe('ready'));
    orchestrator.destroy();
  });

  it('requires activation once, then completes translation', async () => {
    mocks.providerStartsActivated = false;
    const orchestrator = await startOrchestrator(new FakeAdapter());
    await vi.waitFor(() => expect(orchestrator.getState().status.state).toBe('needs_user_activation'));
    expect(mocks.translationCalls).toBe(0);
    await orchestrator.activate();
    expect(orchestrator.getState().status.state).toBe('ready');
    expect(mocks.translationCalls).toBe(1);
    orchestrator.destroy();
  });

  it('applies live settings and clears rendering when disabled', async () => {
    const orchestrator = await startOrchestrator(new FakeAdapter());
    await vi.waitFor(() => expect(orchestrator.getState().status.state).toBe('ready'));
    mocks.watchCallback?.({ ...mocks.settings, displayMode: 'translation-only' });
    await vi.waitFor(() => expect(mocks.overlays[0]?.settingsApplied).toHaveLength(1));
    mocks.watchCallback?.({ ...mocks.settings, enabled: false, displayMode: 'translation-only' });
    await vi.waitFor(() => expect(orchestrator.getState().status.state).toBe('disabled'));
    expect(mocks.overlays[0]?.track).toBeUndefined();
    orchestrator.destroy();
  });

  it('never renders an obsolete target after the user changes languages', async () => {
    mocks.holdNextTranslation = true;
    const orchestrator = await startOrchestrator(new FakeAdapter());
    await vi.waitFor(() => expect(mocks.translationCalls).toBe(1));

    mocks.settings.preferredTargetLanguage = 'ar';
    mocks.watchCallback?.({ ...mocks.settings });
    await vi.waitFor(() => expect(orchestrator.getState()).toMatchObject({ targetLanguage: 'ar', status: { state: 'ready' } }));
    expect(mocks.translationCalls).toBe(2);
    expect(mocks.overlays[0]?.track?.cues[0]?.translatedText).toBe('ar→ Hallo');

    mocks.releaseTranslation?.();
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(orchestrator.getState().targetLanguage).toBe('ar');
    expect(mocks.overlays[0]?.track?.cues[0]?.translatedText).toBe('ar→ Hallo');
    orchestrator.destroy();
  });

  it('keys the cache by platform so two services cannot collide', async () => {
    const adapter = new FakeAdapter();
    const orchestrator = await startOrchestrator(adapter);
    await vi.waitFor(() => expect(orchestrator.getState().status.state).toBe('ready'));
    expect(mocks.cache.has('content:netflix:100')).toBe(true);
    orchestrator.destroy();
  });

  it('stops the adapter when the orchestrator is destroyed', async () => {
    const adapter = new FakeAdapter();
    const orchestrator = await startOrchestrator(adapter);
    await vi.waitFor(() => expect(orchestrator.getState().status.state).toBe('ready'));
    orchestrator.destroy();
    expect(adapter.stopped).toBe(true);
  });

  it('re-runs the pipeline when a later manifest promotes a different track', async () => {
    const adapter = new FakeAdapter();
    const orchestrator = await startOrchestrator(adapter);
    await vi.waitFor(() => expect(orchestrator.getState().status.state).toBe('ready'));
    expect(adapter.extractCalls).toEqual(['100']);

    // Netflix can hydrate a better dialogue track for the same title.
    adapter.selection = { kind: 'ready', trackId: 'T:de-full', language: 'de', profile: 'dfxp' };
    adapter.host?.onSourceAvailabilityChanged();
    await vi.waitFor(() => expect(adapter.extractCalls).toEqual(['100', '100']));
    orchestrator.destroy();
  });

  it('does not restart translation when the chosen track is unchanged', async () => {
    const adapter = new FakeAdapter();
    const orchestrator = await startOrchestrator(adapter);
    await vi.waitFor(() => expect(orchestrator.getState().status.state).toBe('ready'));
    const callsBefore = adapter.extractCalls.length;
    const translationsBefore = mocks.translationCalls;

    adapter.host?.onSourceAvailabilityChanged();
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(adapter.extractCalls).toHaveLength(callsBefore);
    expect(mocks.translationCalls).toBe(translationsBefore);
    orchestrator.destroy();
  });

  it('keeps the loaded track when the player element is replaced', async () => {
    const adapter = new FakeAdapter();
    const orchestrator = await startOrchestrator(adapter);
    await vi.waitFor(() => expect(orchestrator.getState().status.state).toBe('ready'));
    const rendered = mocks.overlays[0]?.track;

    // An ad break or error recovery can swap the media element.
    adapter.attachVideo();
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(adapter.extractCalls).toEqual(['100']);
    expect(mocks.overlays[0]?.track).toBe(rendered);
    expect(orchestrator.getState().status.state).toBe('ready');
    orchestrator.destroy();
  });

  it('reports ad state through the view model', async () => {
    const adapter = new FakeAdapter();
    const orchestrator = await startOrchestrator(adapter);
    await vi.waitFor(() => expect(orchestrator.getState().status.state).toBe('ready'));
    expect(orchestrator.getState().adPlaying).toBe(false);
    adapter.adPlaying = true;
    adapter.host?.onAdStateChanged(true);
    expect(orchestrator.getState().adPlaying).toBe(true);
    orchestrator.destroy();
  });
});
