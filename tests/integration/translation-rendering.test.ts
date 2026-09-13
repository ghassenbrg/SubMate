import { afterEach, describe, expect, it, vi } from 'vitest';
import { SubtitleOverlay } from '../../src/renderer/subtitle-overlay';
import { defaultSettings } from '../../src/settings/defaults';
import type { TranslationRequest } from '../../src/subtitles/models';
import { ChromeTranslatorProvider } from '../../src/translation/providers/chrome-translator';
import { mergeTranslation } from '../../src/subtitles/validation';
import { sourceTrack } from '../unit/validation.test';
import { visibleNetflixSubtitleText } from '../../src/platforms/netflix/native-captions';

afterEach(() => document.getElementById('submate-root')?.remove());

describe('synthetic episode translation and rendering', () => {
  it('applies background-free, outlined, colored, and transparent subtitle styles safely', () => {
    const video = document.createElement('video');
    Object.defineProperty(video, 'paused', { value: true });
    const overlay = new SubtitleOverlay(defaultSettings(), { onActivate() {}, onRetry() {}, onDisplayMode() {}, onToggleEnabled() {}, onOpenSettings() {} });
    overlay.setPlayer(video);
    expect(overlay.host.style.getPropertyValue('--ft-background')).toBe('rgba(0,0,0,.68)');
    overlay.applySettings({
      ...defaultSettings(),
      subtitleStylePreset: 'custom',
      subtitleBackground: 'none',
      subtitleOutline: 'outline',
      subtitleTextColor: '#ffdd33',
      translatedFontWeight: 800,
      subtitleOpacity: .75,
      subtitleLineHeight: 1.5,
    });
    expect(overlay.host.style.getPropertyValue('--ft-background')).toBe('transparent');
    expect(overlay.host.style.getPropertyValue('--ft-text-shadow')).toContain('-1px -1px 0 #000');
    expect(overlay.host.style.getPropertyValue('--ft-color')).toBe('#ffdd33');
    expect(overlay.host.style.getPropertyValue('--ft-weight')).toBe('800');
    expect(overlay.host.style.getPropertyValue('--ft-opacity')).toBe('0.75');
    expect(overlay.host.style.getPropertyValue('--ft-line-height')).toBe('1.5');
    overlay.destroy();
  });

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
    // The renderer no longer scrapes Netflix itself; the adapter supplies the
    // native-caption reader through the injected playback context.
    overlay.setPlaybackContext({ isAdPlaying: () => false, getNativeSubtitleText: visibleNetflixSubtitleText });
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
    const internals = overlay as unknown as { sourceLine: HTMLDivElement; translationLine: HTMLDivElement };
    expect(internals.sourceLine.style.display).toBe('none');
    expect(internals.translationLine.style.display).not.toBe('none');
    overlay.destroy();
    netflixContainer.remove();
    video.remove();
  });

  it('shows its own source line only when Netflix is not already drawing one', () => {
    const overlay = new SubtitleOverlay({ ...defaultSettings(), onboardingComplete: true }, { onActivate() {}, onRetry() {}, onDisplayMode() {}, onToggleEnabled() {}, onOpenSettings() {} });
    const video = document.createElement('video');
    Object.defineProperty(video, 'currentTime', { value: 1.5, writable: true });
    Object.defineProperty(video, 'paused', { value: true });
    const netflixContainer = document.createElement('div');
    netflixContainer.className = 'player-timedtext';
    const netflixLine = document.createElement('div');
    netflixLine.className = 'player-timedtext-text-container';
    netflixLine.textContent = 'こんにちは';
    netflixContainer.append(netflixLine);
    document.body.append(video, netflixContainer);
    // The renderer no longer scrapes Netflix itself; the adapter supplies the
    // native-caption reader through the injected playback context.
    overlay.setPlaybackContext({ isAdPlaying: () => false, getNativeSubtitleText: visibleNetflixSubtitleText });
    overlay.setPlayer(video);
    overlay.setTrack({
      ...sourceTrack(),
      sourceLanguage: 'ja',
      cues: [{ id: 'greeting', startMs: 1_000, endMs: 2_000, sourceText: 'こんにちは', translatedText: 'Hello' }],
    });
    const internals = overlay as unknown as { sourceLine: HTMLDivElement };
    expect(internals.sourceLine.style.display).toBe('none');

    netflixContainer.style.display = 'none';
    (overlay as unknown as { lastNativeSampleAt: number }).lastNativeSampleAt = Number.NEGATIVE_INFINITY;
    video.dispatchEvent(new Event('seeked'));
    expect(internals.sourceLine.style.display).not.toBe('none');

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
    // The renderer no longer scrapes Netflix itself; the adapter supplies the
    // native-caption reader through the injected playback context.
    overlay.setPlaybackContext({ isAdPlaying: () => false, getNativeSubtitleText: visibleNetflixSubtitleText });
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

  const actions = { onActivate() {}, onRetry() {}, onDisplayMode() {}, onToggleEnabled() {}, onOpenSettings() {} };
  const withPlayer = (settings = {}) => {
    const overlay = new SubtitleOverlay({ ...defaultSettings(), onboardingComplete: true, ...settings }, actions);
    const video = document.createElement('video');
    Object.defineProperty(video, 'paused', { value: true });
    document.body.append(video);
    overlay.setPlayer(video);
    const internals = overlay as unknown as { indicator: HTMLButtonElement; shadow: ShadowRoot };
    return {
      overlay,
      indicator: internals.indicator,
      shadow: internals.shadow,
      cleanup: () => { overlay.destroy(); video.remove(); },
    };
  };

  it('hides the indicator with the player controls and brings it back on activity', () => {
    vi.useFakeTimers();
    const { overlay, indicator, cleanup } = withPlayer();
    overlay.setStatus({ state: 'ready' });
    expect(indicator.classList.contains('idle')).toBe(false);
    vi.advanceTimersByTime(3_000);
    expect(indicator.classList.contains('idle')).toBe(true);
    document.dispatchEvent(new Event('pointermove'));
    expect(indicator.classList.contains('idle')).toBe(false);
    cleanup();
    vi.useRealTimers();
  });

  it('hides the indicator as soon as the pointer leaves the page', () => {
    const { indicator, cleanup } = withPlayer();
    document.documentElement.dispatchEvent(new Event('mouseleave'));
    expect(indicator.classList.contains('idle')).toBe(true);
    cleanup();
  });

  it('hides in every state, not only when translation is ready', () => {
    vi.useFakeTimers();
    const { overlay, indicator, cleanup } = withPlayer();
    overlay.setStatus({ state: 'translating', progress: .2 });
    vi.advanceTimersByTime(3_000);
    expect(indicator.classList.contains('idle')).toBe(true);
    // Progress ticks are not a reason to show the control again.
    overlay.setStatus({ state: 'translating', progress: .4 });
    expect(indicator.classList.contains('idle')).toBe(true);
    cleanup();
    vi.useRealTimers();
  });

  it('never hides the indicator while its panel is open', () => {
    vi.useFakeTimers();
    const { overlay, indicator, cleanup } = withPlayer();
    overlay.setStatus({ state: 'failed' });
    vi.advanceTimersByTime(10_000);
    document.documentElement.dispatchEvent(new Event('mouseleave'));
    expect(indicator.classList.contains('idle')).toBe(false);
    cleanup();
    vi.useRealTimers();
  });

  it('keeps the indicator visible while the pointer rests on it', () => {
    vi.useFakeTimers();
    const { overlay, indicator, cleanup } = withPlayer();
    overlay.setStatus({ state: 'ready' });

    // A stationary pointer emits no further pointermove events, so the control
    // must not hide from under the cursor the user is aiming with.
    indicator.dispatchEvent(new Event('pointerenter'));
    vi.advanceTimersByTime(5_000);
    expect(indicator.classList.contains('idle')).toBe(false);

    // Leaving restarts the countdown so the control still gets out of the way.
    indicator.dispatchEvent(new Event('pointerleave'));
    vi.advanceTimersByTime(3_000);
    expect(indicator.classList.contains('idle')).toBe(true);
    cleanup();
    vi.useRealTimers();
  });

  it('follows the theme setting, and the OS when set to system', () => {
    const { overlay, cleanup } = withPlayer({ theme: 'light' });
    expect(overlay.host.dataset.theme).toBe('light');
    overlay.applySettings({ ...defaultSettings(), theme: 'dark' });
    expect(overlay.host.dataset.theme).toBe('dark');
    overlay.applySettings({ ...defaultSettings(), theme: 'system' });
    expect(overlay.host.dataset.theme).toBeUndefined();
    cleanup();
  });

  it('keeps the indicator readable against a light page background, in both themes', () => {
    const { shadow, cleanup } = withPlayer();
    const styles = shadow.querySelector('style')?.textContent ?? '';
    const base = /\.indicator\{[^}]*\}/.exec(styles)?.[0] ?? '';

    // TVer renders a light page and our host spans the viewport, so a mostly
    // transparent chip washed out to invisible. Each theme must give the chip
    // its own near-opaque ground plus an edge rather than borrowing the page's.
    expect(base).toContain('background:var(--sm-indicator)');
    expect(base).toContain('border:1px solid');
    expect(base).not.toContain('box-shadow:none');
    const grounds = [...styles.matchAll(/--sm-indicator:rgba\(\d+,\d+,\d+,(\.\d+)\)/g)].map((match) => Number(match[1]));
    expect(grounds).toHaveLength(3);
    for (const alpha of grounds) expect(alpha).toBeGreaterThanOrEqual(.9);
    cleanup();
  });

  it('marks the active quick-control display mode and updates selection immediately', () => {
    const onDisplayMode = vi.fn();
    const overlay = new SubtitleOverlay(defaultSettings(), { onActivate() {}, onRetry() {}, onDisplayMode, onToggleEnabled() {}, onOpenSettings() {} });
    const shadow = (overlay as unknown as { shadow: ShadowRoot }).shadow;
    const bilingual = shadow.querySelector<HTMLButtonElement>('[data-mode="bilingual"]')!;
    const translationOnly = shadow.querySelector<HTMLButtonElement>('[data-mode="translation-only"]')!;
    expect(bilingual.getAttribute('aria-pressed')).toBe('true');
    expect(translationOnly.getAttribute('aria-pressed')).toBe('false');
    translationOnly.click();
    expect(onDisplayMode).toHaveBeenCalledWith('translation-only');
    expect(bilingual.getAttribute('aria-pressed')).toBe('false');
    expect(translationOnly.getAttribute('aria-pressed')).toBe('true');
    overlay.applySettings({ ...defaultSettings(), displayMode: 'off' });
    expect(shadow.querySelector('[data-mode="off"]')?.getAttribute('aria-pressed')).toBe('true');
    overlay.destroy();
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
    // The renderer no longer scrapes Netflix itself; the adapter supplies the
    // native-caption reader through the injected playback context.
    overlay.setPlaybackContext({ isAdPlaying: () => false, getNativeSubtitleText: visibleNetflixSubtitleText });
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
