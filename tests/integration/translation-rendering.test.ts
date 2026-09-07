import { afterEach, describe, expect, it, vi } from 'vitest';
import { SubtitleOverlay } from '../../src/renderer/subtitle-overlay';
import { defaultSettings } from '../../src/settings/defaults';
import type { TranslationRequest } from '../../src/subtitles/models';
import { ChromeTranslatorProvider } from '../../src/translation/providers/chrome-translator';
import { mergeTranslation } from '../../src/subtitles/validation';
import { sourceTrack } from '../unit/validation.test';

afterEach(() => document.getElementById('flixtranslate-root')?.remove());

describe('synthetic episode translation and rendering', () => {
  it('translates a whole synthetic episode with IDs and renders safely across seek', async () => {
    const destroy = vi.fn();
    Object.defineProperty(globalThis, 'Translator', { configurable: true, value: {
      availability: vi.fn().mockResolvedValue('available'),
      create: vi.fn().mockResolvedValue({ translate: async (text: string) => `→ ${text}`, destroy }),
    } });
    const provider = new ChromeTranslatorProvider();
    const progress: number[] = [];
    await provider.activate('de', 'ar');
    const source = sourceTrack();
    source.cues[0]!.sourceText = '<script>source</script>';
    const request: TranslationRequest = { sourceLanguage: 'de', targetLanguage: 'ar', sourceHash: source.sourceHash, cues: source.cues.map((cue) => ({ id: cue.id, text: cue.sourceText })) };
    const result = await provider.translate(request, (event) => progress.push(event.progress));
    const track = mergeTranslation(source, result);
    expect(result.translations.map((item) => item.id)).toEqual(source.cues.map((cue) => cue.id));
    expect(progress.at(-1)).toBe(1);

    const overlay = new SubtitleOverlay({ ...defaultSettings(), onboardingComplete: true }, { onActivate() {}, onRetry() {}, onDisplayMode() {}, onToggleEnabled() {}, onOpenSettings() {} });
    const video = document.createElement('video');
    Object.defineProperty(video, 'currentTime', { value: 1.5, writable: true });
    Object.defineProperty(video, 'paused', { value: true });
    document.body.append(video);
    overlay.setPlayer(video); overlay.setTrack(track); overlay.setStatus({ state: 'ready' });
    expect(overlay.getRenderedText()).toEqual({ source: '<script>source</script>', translation: '→ <script>source</script>', visible: true });
    expect(overlay.host.dataset.subtitleVisible).toBe('true');
    video.currentTime = 2.5; video.dispatchEvent(new Event('seeked'));
    expect(overlay.getRenderedText().visible).toBe(false);
    video.currentTime = 3.5; video.dispatchEvent(new Event('seeked'));
    expect(overlay.getRenderedText().translation).toBe('→ Welt');
    overlay.applySettings({ ...defaultSettings(), displayMode: 'translation-only', onboardingComplete: true });
    expect(overlay.getRenderedText().translation).toBe('→ Welt');
    overlay.destroy(); provider.destroy(); expect(destroy).toHaveBeenCalled();
  });

  it('reports model download progress and checks arbitrary language pairs dynamically', async () => {
    let monitor: ((event: Event & { loaded: number }) => void) | undefined;
    Object.defineProperty(globalThis, 'Translator', { configurable: true, value: {
      availability: vi.fn().mockResolvedValue('downloadable'),
      create: vi.fn(({ monitor: setup }) => {
        setup({ addEventListener: (_name: string, listener: typeof monitor) => { monitor = listener; } });
        monitor?.(Object.assign(new Event('downloadprogress'), { loaded: .72 }));
        return Promise.resolve({ translate: async (text: string) => text, destroy() {} });
      }),
    } });
    const provider = new ChromeTranslatorProvider();
    expect(await provider.availability('ko', 'fr')).toBe('downloadable');
    const values: number[] = [];
    await provider.activate('ko', 'fr', (event) => values.push(event.progress));
    expect(values).toEqual([.72]);
  });

  it('falls back to Netflix visible source text when downloadable cue timing differs', () => {
    const overlay = new SubtitleOverlay({ ...defaultSettings(), onboardingComplete: true }, { onActivate() {}, onRetry() {}, onDisplayMode() {}, onToggleEnabled() {}, onOpenSettings() {} });
    const video = document.createElement('video');
    Object.defineProperty(video, 'currentTime', { value: 44, writable: true });
    Object.defineProperty(video, 'paused', { value: true });
    const netflixContainer = document.createElement('div');
    netflixContainer.className = 'player-timedtext';
    const netflixLine = document.createElement('div');
    netflixLine.className = 'player-timedtext-text-container';
    netflixLine.textContent = 'あ～ 考えすぎて\n袋小路に入っちゃったんじゃない？';
    netflixContainer.append(netflixLine);
    document.body.append(video, netflixContainer);
    overlay.setPlayer(video);
    overlay.setTrack({
      ...sourceTrack(),
      sourceLanguage: 'ja',
      cues: [{
        id: 'cue-ja',
        startMs: 140_000,
        endMs: 144_000,
        sourceText: 'あ～ 考えすぎて袋小路に入っちゃったんじゃない？',
        translatedText: 'Maybe you overthought it and reached a dead end?',
      }],
    });
    overlay.setStatus({ state: 'ready' });
    expect(overlay.getRenderedText()).toEqual({
      source: 'あ～ 考えすぎて袋小路に入っちゃったんじゃない？',
      translation: 'Maybe you overthought it and reached a dead end?',
      visible: true,
    });
    expect(overlay.host.dataset.synchronization).toBe('native-text');
    overlay.destroy();
    netflixContainer.remove();
    video.remove();
  });

  it('prefers the visible Netflix cue when a shifted clock points at a different translated cue', () => {
    const overlay = new SubtitleOverlay({ ...defaultSettings(), onboardingComplete: true }, { onActivate() {}, onRetry() {}, onDisplayMode() {}, onToggleEnabled() {}, onOpenSettings() {} });
    const video = document.createElement('video');
    Object.defineProperty(video, 'currentTime', { value: 44, writable: true });
    Object.defineProperty(video, 'paused', { value: true });
    const netflixContainer = document.createElement('div');
    netflixContainer.className = 'player-timedtext';
    const netflixLine = document.createElement('div');
    netflixLine.className = 'player-timedtext-text-container';
    netflixLine.textContent = '今表示されている台詞';
    netflixContainer.append(netflixLine);
    document.body.append(video, netflixContainer);
    overlay.setPlayer(video);
    overlay.setTrack({
      ...sourceTrack(),
      sourceLanguage: 'ja',
      cues: [
        { id: 'wrong-by-time', startMs: 43_000, endMs: 45_000, sourceText: '別の台詞', translatedText: 'A different line' },
        { id: 'right-by-text', startMs: 143_000, endMs: 145_000, sourceText: '今表示されている台詞', translatedText: 'The line visible now' },
      ],
    });
    overlay.setStatus({ state: 'ready' });
    expect(overlay.getRenderedText()).toEqual({
      source: '今表示されている台詞',
      translation: 'The line visible now',
      visible: true,
    });
    expect(overlay.host.dataset.synchronization).toBe('native-text');
    overlay.destroy();
    netflixContainer.remove();
    video.remove();
  });

  it('fades the ready indicator until player pointer activity resumes', () => {
    vi.useFakeTimers();
    const overlay = new SubtitleOverlay({ ...defaultSettings(), onboardingComplete: true }, { onActivate() {}, onRetry() {}, onDisplayMode() {}, onToggleEnabled() {}, onOpenSettings() {} });
    const video = document.createElement('video');
    Object.defineProperty(video, 'paused', { value: true });
    document.body.append(video);
    overlay.setPlayer(video);
    overlay.setStatus({ state: 'ready' });
    const indicator = (overlay as unknown as { indicator: HTMLButtonElement }).indicator;
    expect(indicator.classList.contains('quiet')).toBe(false);
    vi.advanceTimersByTime(2_500);
    expect(indicator.classList.contains('quiet')).toBe(true);
    document.dispatchEvent(new Event('pointermove'));
    expect(indicator.classList.contains('quiet')).toBe(false);
    overlay.destroy();
    video.remove();
    vi.useRealTimers();
  });

  it('renders Arabic, CJK, and mixed-script bilingual cues with automatic direction', () => {
    const overlay = new SubtitleOverlay({ ...defaultSettings(), onboardingComplete: true }, { onActivate() {}, onRetry() {}, onDisplayMode() {}, onToggleEnabled() {}, onOpenSettings() {} });
    const video = document.createElement('video');
    Object.defineProperty(video, 'currentTime', { value: 1.5, writable: true });
    Object.defineProperty(video, 'paused', { value: true });
    document.body.append(video);
    overlay.setPlayer(video);
    overlay.setTrack({
      ...sourceTrack(),
      sourceLanguage: 'ja',
      cues: [{
        id: 'mixed-script',
        startMs: 1_000,
        endMs: 2_000,
        sourceText: '日本語 Netflix 2026',
        translatedText: 'مرحبًا Netflix 2026',
      }],
    });
    overlay.setStatus({ state: 'ready' });
    const internals = overlay as unknown as { sourceLine: HTMLDivElement; translationLine: HTMLDivElement };
    expect(overlay.getRenderedText()).toMatchObject({
      source: '日本語 Netflix 2026',
      translation: 'مرحبًا Netflix 2026',
      visible: true,
    });
    expect(internals.sourceLine.dir).toBe('auto');
    expect(internals.translationLine.dir).toBe('auto');
    overlay.destroy();
    video.remove();
  });

  it('ignores stale Netflix subtitle text inside a hidden native container', () => {
    const overlay = new SubtitleOverlay({ ...defaultSettings(), onboardingComplete: true }, { onActivate() {}, onRetry() {}, onDisplayMode() {}, onToggleEnabled() {}, onOpenSettings() {} });
    const video = document.createElement('video');
    Object.defineProperty(video, 'currentTime', { value: 44, writable: true });
    Object.defineProperty(video, 'paused', { value: true });
    const netflixContainer = document.createElement('div');
    netflixContainer.className = 'player-timedtext';
    netflixContainer.style.visibility = 'hidden';
    const staleLine = document.createElement('div');
    staleLine.className = 'player-timedtext-text-container';
    staleLine.textContent = '古い台詞';
    netflixContainer.append(staleLine);
    document.body.append(video, netflixContainer);
    overlay.setPlayer(video);
    overlay.setTrack({
      ...sourceTrack(),
      sourceLanguage: 'ja',
      cues: [
        { id: 'current', startMs: 43_000, endMs: 45_000, sourceText: '現在の台詞', translatedText: 'Current line' },
        { id: 'stale', startMs: 143_000, endMs: 145_000, sourceText: '古い台詞', translatedText: 'Stale line' },
      ],
    });
    overlay.setStatus({ state: 'ready' });
    expect(overlay.getRenderedText().translation).toBe('Current line');
    expect(overlay.host.dataset.synchronization).toBe('time');
    overlay.destroy();
    netflixContainer.remove();
    video.remove();
  });
});
