import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { CachedTranslation, SubtitleTrack, TranslationRequest, TranslationResult } from '../../src/subtitles/models';
import type { NetflixManifestSnapshot } from '../../src/netflix/netflix-types';

const mocks = vi.hoisted(() => ({
  settings: {
    enabled: true, autoTranslate: true, preferredTargetLanguage: 'fr', translationEngine: 'chrome-local' as const,
    displayMode: 'bilingual' as const, translatedFontScale: 1, verticalPosition: .13, showPlayerStatus: true,
    onboardingComplete: true, debugMode: false,
  },
  cache: new Map<string, unknown>(),
  pageSubtitle: vi.fn(),
  translationCalls: 0,
  bridgeHandlers: undefined as undefined | { onManifest(s: NetflixManifestSnapshot): void; onNavigation(id?: string): void },
  stopBridge: vi.fn(),
  overlays: [] as Array<{ track: SubtitleTrack | undefined; languages: Array<[string | undefined, string | undefined]> }>,
}));

vi.mock('../../src/platforms/netflix/netflix-bridge', () => ({
  startNetflixBridge: (handlers: never) => { mocks.bridgeHandlers = handlers; return mocks.stopBridge; },
  requestPageSubtitle: (...args: unknown[]) => mocks.pageSubtitle(...args),
}));

vi.mock('../../src/cache/messages', () => ({
  sendCacheMessage: async (message: Record<string, unknown>) => {
    switch (message.type) {
      case 'CACHE_PUT_SOURCE': {
        const track = message.track as SubtitleTrack;
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
  watchSettings: () => () => undefined,
}));

vi.mock('../../src/renderer/subtitle-overlay', () => ({
  SubtitleOverlay: class {
    state = { track: undefined as SubtitleTrack | undefined, languages: [] as Array<[string | undefined, string | undefined]> };
    constructor() { mocks.overlays.push(this.state); }
    setPlayer() {} setPlaybackContext() {} setStatus() {} applySettings() {} destroy() {}
    setTrack(track?: SubtitleTrack) { this.state.track = track; }
    setLanguages(source?: string, target?: string) { this.state.languages.push([source, target]); }
  },
}));

vi.mock('../../src/translation/providers/chrome-translator', () => ({
  ChromeTranslatorProvider: class {
    id = 'chrome-local'; version = 'translator-api-v1';
    async availability() { return 'available' as const; }
    needsActivation() { return false; }
    async activate() {}
    async translate(input: TranslationRequest): Promise<TranslationResult> {
      mocks.translationCalls += 1;
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
import { NetflixAdapter } from '../../src/platforms/netflix/netflix-adapter';

const ttml = (text: string) =>
  `<tt xmlns="http://www.w3.org/ns/ttml"><body><div><p begin="10000000" end="20000000">${text}</p></div></body></tt>`;

const snapshot = (contentId: string, language: string): NetflixManifestSnapshot => ({
  protocolVersion: 1, contentId, capturedAt: Date.now(), audioLanguage: language,
  tracks: [{
    trackId: `T:${language}`, language, label: language, isForcedNarrative: false, isNoneTrack: false,
    hydrated: true, downloads: [{ profile: 'dfxp-ls-sdh', kind: 'text', urls: [] }],
  }],
});

const attachVideo = () => {
  const video = document.createElement('video');
  Object.defineProperty(video, 'paused', { value: true });
  document.body.append(video);
  return video;
};

const nextTick = () => new Promise((resolve) => setTimeout(resolve, 0));

beforeEach(() => {
  document.body.replaceChildren();
  mocks.cache.clear();
  mocks.pageSubtitle.mockReset();
  mocks.translationCalls = 0;
  mocks.overlays.length = 0;
  mocks.bridgeHandlers = undefined;
  mocks.settings.preferredTargetLanguage = 'fr';
  history.replaceState({}, '', '/watch/100');
});

describe('Netflix regression through the platform abstraction', () => {
  it('matches Netflix hosts only', () => {
    const adapter = new NetflixAdapter();
    expect(adapter.matches(new URL('https://www.netflix.com/watch/100'))).toBe(true);
    expect(adapter.matches(new URL('https://tver.jp/episodes/a'))).toBe(false);
  });

  it('captures a manifest, downloads TTML, translates and renders', async () => {
    mocks.pageSubtitle.mockResolvedValue({ text: ttml('Hallo'), contentType: 'application/ttml+xml' });
    const orchestrator = new EpisodeOrchestrator(new NetflixAdapter());
    await orchestrator.initialize();
    attachVideo();
    await nextTick();
    mocks.bridgeHandlers?.onManifest(snapshot('100', 'de'));

    await vi.waitFor(() => expect(orchestrator.getState().status.state).toBe('ready'));
    expect(mocks.pageSubtitle).toHaveBeenCalledWith('100', 'T:de', 'dfxp-ls-sdh', expect.any(AbortSignal));
    expect(orchestrator.getState()).toMatchObject({ platform: 'netflix', contentId: '100', sourceLanguage: 'de' });
    expect(mocks.overlays[0]?.track?.cues[0]?.translatedText).toBe('fr→ Hallo');
    orchestrator.destroy();
  });

  it('ignores preload manifests for a title that is not the current route', async () => {
    const orchestrator = new EpisodeOrchestrator(new NetflixAdapter());
    await orchestrator.initialize();
    attachVideo();
    await nextTick();
    // Netflix emits manifests for hover previews and the next episode.
    mocks.bridgeHandlers?.onManifest(snapshot('999', 'de'));
    await nextTick();
    expect(mocks.pageSubtitle).not.toHaveBeenCalled();
    orchestrator.destroy();
  });

  it('skips translation when Netflix already offers the target language', async () => {
    const orchestrator = new EpisodeOrchestrator(new NetflixAdapter());
    await orchestrator.initialize();
    attachVideo();
    await nextTick();
    mocks.bridgeHandlers?.onManifest(snapshot('100', 'fr'));
    await vi.waitFor(() => expect(orchestrator.getState().status.state).toBe('target_available'));
    expect(mocks.pageSubtitle).not.toHaveBeenCalled();
    expect(mocks.translationCalls).toBe(0);
    orchestrator.destroy();
  });

  it('follows SPA navigation to a new episode', async () => {
    mocks.pageSubtitle.mockImplementation((contentId: string) =>
      Promise.resolve({ text: ttml(contentId === '200' ? '안녕' : 'Hallo'), contentType: 'application/ttml+xml' }));
    const orchestrator = new EpisodeOrchestrator(new NetflixAdapter());
    await orchestrator.initialize();
    attachVideo();
    await nextTick();
    mocks.bridgeHandlers?.onManifest(snapshot('100', 'de'));
    await vi.waitFor(() => expect(orchestrator.getState().status.state).toBe('ready'));

    history.replaceState({}, '', '/watch/200');
    mocks.bridgeHandlers?.onNavigation('200');
    mocks.bridgeHandlers?.onManifest(snapshot('200', 'ko'));
    await vi.waitFor(() => expect(orchestrator.getState()).toMatchObject({ contentId: '200', sourceLanguage: 'ko', status: { state: 'ready' } }));
    expect(mocks.overlays[0]?.track?.cues[0]?.sourceText).toBe('안녕');
    orchestrator.destroy();
  });

  it('reports no ad state for Netflix and exposes the native caption reader', () => {
    const adapter = new NetflixAdapter();
    expect(adapter.isAdPlaying()).toBe(false);
    expect(adapter.capabilities.supportsAdDetection).toBe(false);
    expect(typeof adapter.getNativeSubtitleText).toBe('function');
    expect(adapter.getNativeSubtitleText()).toBe('');
  });

  it('tears down the manifest bridge when stopped', async () => {
    const orchestrator = new EpisodeOrchestrator(new NetflixAdapter());
    await orchestrator.initialize();
    orchestrator.destroy();
    expect(mocks.stopBridge).toHaveBeenCalled();
  });
});
