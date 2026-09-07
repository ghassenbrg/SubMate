import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { CachedTranslation, FlixTranslateViewState, SubtitleTrack, TranslationRequest, TranslationResult } from '../../src/subtitles/models';

const mocks = vi.hoisted(() => ({
  settings: {
    enabled: true, autoTranslate: true, preferredTargetLanguage: 'fr', translationEngine: 'chrome-local' as const,
    displayMode: 'bilingual' as const, translatedFontScale: 1, verticalPosition: .13, showPlayerStatus: true,
    onboardingComplete: true, debugMode: false,
  },
  cache: new Map<string, unknown>(),
  pageSubtitle: vi.fn(),
  translationCalls: 0,
  holdNextTranslation: false,
  releaseTranslation: undefined as (() => void) | undefined,
  providerStartsActivated: true,
  watchCallback: undefined as ((settings: unknown) => void) | undefined,
  overlays: [] as Array<{ track: SubtitleTrack | undefined; statuses: unknown[]; languages: Array<[string | undefined, string | undefined]>; settingsApplied: unknown[] }>,
}));

vi.mock('../../src/cache/messages', () => ({
  sendCacheMessage: async (message: Record<string, unknown>) => {
    switch (message.type) {
      case 'CACHE_PUT_SOURCE': {
        const track = message.track as SubtitleTrack;
        mocks.cache.set(`source:${track.sourceHash}`, track);
        mocks.cache.set(`content:${track.contentId}`, track);
        return undefined;
      }
      case 'CACHE_GET_CONTENT_SOURCE': return mocks.cache.get(`content:${message.contentId as string}`);
      case 'CACHE_GET_TRANSLATION': return mocks.cache.get(`translation:${message.cacheKey as string}`);
      case 'CACHE_PUT_TRANSLATION': mocks.cache.set(`translation:${(message.record as CachedTranslation).cacheKey}`, message.record); return undefined;
      default: return undefined;
    }
  },
}));

vi.mock('../../src/content/message-bridge', () => ({ requestPageSubtitle: (...args: unknown[]) => mocks.pageSubtitle(...args) }));
vi.mock('../../src/settings/store', () => ({
  loadSettings: async () => ({ ...mocks.settings }),
  saveSettings: async (patch: Record<string, unknown>) => Object.assign(mocks.settings, patch),
  watchSettings: (callback: (settings: unknown) => void) => { mocks.watchCallback = callback; return () => { mocks.watchCallback = undefined; }; },
}));
vi.mock('../../src/renderer/subtitle-overlay', () => ({
  SubtitleOverlay: class {
    state: { track: SubtitleTrack | undefined; statuses: unknown[]; languages: Array<[string | undefined, string | undefined]>; settingsApplied: unknown[] } = { track: undefined, statuses: [], languages: [], settingsApplied: [] };
    constructor() { mocks.overlays.push(this.state); }
    setPlayer() {}
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
      return { sourceHash: input.sourceHash, sourceLanguage: input.sourceLanguage, targetLanguage: input.targetLanguage, engine: { id: this.id, version: this.version }, translations: input.cues.map((cue) => ({ id: cue.id, text: `${input.targetLanguage}→ ${cue.text}` })) };
    }
    destroy() {}
  },
}));

import { EpisodeOrchestrator } from '../../src/content/episode-orchestrator';
import type { NetflixManifestSnapshot } from '../../src/netflix/netflix-types';

const ttml = (text: string) => `<tt xmlns="http://www.w3.org/ns/ttml"><body><div><p begin="10000000" end="20000000">${text}</p></div></body></tt>`;
const snapshot = (contentId: string, language: string): NetflixManifestSnapshot => ({
  protocolVersion: 1, contentId, capturedAt: Date.now(), audioLanguage: language,
  tracks: [{ trackId: `T:${language}`, language, label: language, isForcedNarrative: false, isNoneTrack: false, hydrated: true, downloads: [{ profile: 'dfxp-ls-sdh', kind: 'text', urls: [] }] }],
});

const video = () => {
  const value = document.createElement('video');
  Object.defineProperty(value, 'paused', { value: true });
  return value;
};

beforeEach(() => {
  mocks.cache.clear(); mocks.pageSubtitle.mockReset(); mocks.translationCalls = 0; mocks.overlays.length = 0;
  mocks.holdNextTranslation = false; mocks.releaseTranslation = undefined;
  mocks.providerStartsActivated = true; mocks.watchCallback = undefined;
  mocks.settings.enabled = true; mocks.settings.autoTranslate = true; mocks.settings.preferredTargetLanguage = 'fr'; mocks.settings.translationEngine = 'chrome-local';
  history.replaceState({}, '', '/watch/100');
});

describe('episode orchestration', () => {
  it('extracts, hashes, translates, validates, renders, and then uses an exact cache hit', async () => {
    mocks.pageSubtitle.mockResolvedValue({ text: ttml('Hallo'), contentType: 'application/ttml+xml' });
    const first = new EpisodeOrchestrator(); await first.initialize(); first.setPlayer(video()); first.handleManifest(snapshot('100', 'de'));
    await vi.waitFor(() => expect(first.getState().status.state).toBe('ready'));
    expect(first.getState()).toMatchObject({ sourceLanguage: 'de', targetLanguage: 'fr', sourceCueCount: 1 });
    expect(mocks.overlays[0]?.track?.cues[0]?.translatedText).toBe('fr→ Hallo');
    expect(mocks.translationCalls).toBe(1);
    first.destroy();

    const second = new EpisodeOrchestrator(); await second.initialize(); second.setPlayer(video()); second.handleManifest(snapshot('100', 'de'));
    await vi.waitFor(() => expect(second.getState().status.state).toBe('ready'));
    expect(second.getState().status.cacheHit).toBe(true);
    expect(mocks.translationCalls).toBe(1);
    second.destroy();
  });

  it('restores a cached unchanged episode when Netflix resumes without a fresh manifest', async () => {
    const source: SubtitleTrack = {
      platform: 'netflix', contentId: '100', trackId: 'T:de', sourceLanguage: 'de', kind: 'text', profile: 'dfxp-ls-sdh',
      cues: [{ id: 'cached-cue', startMs: 1_000, endMs: 2_000, sourceText: 'Hallo' }], sourceHash: 'cached-source',
    };
    mocks.cache.set('content:100', source);
    const manager = new (await import('../../src/translation/translation-manager')).TranslationManager();
    await manager.save(source, {
      sourceHash: source.sourceHash,
      sourceLanguage: 'de',
      targetLanguage: 'fr',
      engine: { id: 'chrome-local', version: 'translator-api-v1' },
      translations: [{ id: 'cached-cue', text: 'Bonjour' }],
    });

    const orchestrator = new EpisodeOrchestrator();
    await orchestrator.initialize();
    orchestrator.setPlayer(video());
    await vi.waitFor(() => expect(orchestrator.getState()).toMatchObject({
      contentDetected: true,
      contentId: '100',
      sourceLanguage: 'de',
      sourceCueCount: 1,
      status: { state: 'ready', cacheHit: true },
    }));
    expect(mocks.overlays[0]?.track?.cues[0]?.translatedText).toBe('Bonjour');
    expect(mocks.pageSubtitle).not.toHaveBeenCalled();
    expect(mocks.translationCalls).toBe(0);
    orchestrator.destroy();
  });

  it('never leaves a cached old target rendered after a manifest-less target change', async () => {
    const source: SubtitleTrack = {
      platform: 'netflix', contentId: '100', trackId: 'T:de', sourceLanguage: 'de', kind: 'text', profile: 'dfxp-ls-sdh',
      cues: [{ id: 'cached-cue', startMs: 1_000, endMs: 2_000, sourceText: 'Hallo' }], sourceHash: 'cached-source',
    };
    mocks.cache.set('content:100', source);
    const manager = new (await import('../../src/translation/translation-manager')).TranslationManager();
    await manager.save(source, {
      sourceHash: source.sourceHash,
      sourceLanguage: 'de',
      targetLanguage: 'fr',
      engine: { id: 'chrome-local', version: 'translator-api-v1' },
      translations: [{ id: 'cached-cue', text: 'Bonjour' }],
    });
    const orchestrator = new EpisodeOrchestrator();
    await orchestrator.initialize();
    orchestrator.setPlayer(video());
    await vi.waitFor(() => expect(orchestrator.getState().status.state).toBe('ready'));

    mocks.settings.preferredTargetLanguage = 'ar';
    mocks.watchCallback?.({ ...mocks.settings });
    await vi.waitFor(() => expect(orchestrator.getState()).toMatchObject({
      targetLanguage: 'ar',
      status: { state: 'discovering' },
    }));
    expect(mocks.overlays[0]?.track).toBeUndefined();
    expect(mocks.overlays[0]?.languages.at(-1)).not.toEqual(['de', 'ar']);
    orchestrator.destroy();
  });

  it('prevents an obsolete Episode A job from rendering over Episode B', async () => {
    let resolveA!: (value: { text: string; contentType: string }) => void;
    mocks.pageSubtitle.mockImplementation((contentId: string) => contentId === '100'
      ? new Promise((resolve) => { resolveA = resolve; })
      : Promise.resolve({ text: ttml('안녕'), contentType: 'application/ttml+xml' }));
    const states: FlixTranslateViewState[] = [];
    const orchestrator = new EpisodeOrchestrator(); await orchestrator.initialize(); orchestrator.onState((state) => states.push(state)); orchestrator.setPlayer(video());
    orchestrator.handleManifest(snapshot('100', 'de'));
    await vi.waitFor(() => expect(mocks.pageSubtitle).toHaveBeenCalledWith('100', 'T:de', 'dfxp-ls-sdh', expect.any(AbortSignal)));
    history.replaceState({}, '', '/watch/200'); orchestrator.handleNavigation('200'); orchestrator.handleManifest(snapshot('200', 'ko'));
    await vi.waitFor(() => expect(orchestrator.getState().status.state).toBe('ready'));
    resolveA({ text: ttml('STALE'), contentType: 'application/ttml+xml' });
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(orchestrator.getState()).toMatchObject({ contentId: '200', sourceLanguage: 'ko', status: { state: 'ready' } });
    expect(mocks.overlays[0]?.track?.contentId).toBe('200');
    expect(mocks.overlays[0]?.track?.cues[0]?.sourceText).toBe('안녕');
    expect(states.some((state) => state.contentId === '200' && state.status.state === 'ready')).toBe(true);
    orchestrator.destroy();
  });

  it('does not regenerate when Netflix already provides the target language', async () => {
    const orchestrator = new EpisodeOrchestrator(); await orchestrator.initialize(); orchestrator.setPlayer(video()); orchestrator.handleManifest(snapshot('100', 'fr'));
    await vi.waitFor(() => expect(orchestrator.getState().status.state).toBe('target_available'));
    expect(mocks.pageSubtitle).not.toHaveBeenCalled();
    expect(mocks.translationCalls).toBe(0);
    orchestrator.destroy();
  });

  it('requires the minimum activation once, then completes translation', async () => {
    mocks.providerStartsActivated = false;
    mocks.pageSubtitle.mockResolvedValue({ text: ttml('Hallo'), contentType: 'application/ttml+xml' });
    const orchestrator = new EpisodeOrchestrator(); await orchestrator.initialize(); orchestrator.setPlayer(video()); orchestrator.handleManifest(snapshot('100', 'de'));
    await vi.waitFor(() => expect(orchestrator.getState().status.state).toBe('needs_user_activation'));
    expect(mocks.translationCalls).toBe(0);
    await orchestrator.activate();
    expect(orchestrator.getState().status.state).toBe('ready');
    expect(mocks.translationCalls).toBe(1);
    orchestrator.destroy();
  });

  it('applies live settings and clears rendering when disabled', async () => {
    mocks.pageSubtitle.mockResolvedValue({ text: ttml('Hallo'), contentType: 'application/ttml+xml' });
    const orchestrator = new EpisodeOrchestrator(); await orchestrator.initialize(); orchestrator.setPlayer(video()); orchestrator.handleManifest(snapshot('100', 'de'));
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
    mocks.pageSubtitle.mockResolvedValue({ text: ttml('Hallo'), contentType: 'application/ttml+xml' });
    const orchestrator = new EpisodeOrchestrator();
    await orchestrator.initialize();
    orchestrator.setPlayer(video());
    orchestrator.handleManifest(snapshot('100', 'de'));
    await vi.waitFor(() => expect(mocks.translationCalls).toBe(1));

    mocks.settings.preferredTargetLanguage = 'ar';
    mocks.watchCallback?.({ ...mocks.settings });
    await vi.waitFor(() => expect(orchestrator.getState()).toMatchObject({
      targetLanguage: 'ar',
      status: { state: 'ready' },
    }));
    expect(mocks.translationCalls).toBe(2);
    expect(mocks.overlays[0]?.track?.cues[0]?.translatedText).toBe('ar→ Hallo');

    mocks.releaseTranslation?.();
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(orchestrator.getState().targetLanguage).toBe('ar');
    expect(mocks.overlays[0]?.track?.cues[0]?.translatedText).toBe('ar→ Hallo');
    orchestrator.destroy();
  });
});
