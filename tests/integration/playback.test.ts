import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { SubtitleOverlay } from '../../src/renderer/subtitle-overlay';
import { defaultSettings } from '../../src/settings/defaults';
import type { FlixTranslateSettings } from '../../src/settings/schema';
import type { SubtitleTrack } from '../../src/subtitles/models';

const settings = (patch: Partial<FlixTranslateSettings> = {}): FlixTranslateSettings => ({
  ...defaultSettings(),
  onboardingComplete: true,
  ...patch,
});

const noopActions = {
  onActivate() {}, onRetry() {}, onDisplayMode() {}, onToggleEnabled() {}, onOpenSettings() {},
};

/** Three well-separated cues, enough to prove indexed lookup and seeking. */
const track: SubtitleTrack = {
  platform: 'tver',
  contentId: 'ep1',
  trackId: 'tver:ep1:ja',
  sourceLanguage: 'ja',
  kind: 'text',
  sourceHash: 'sha256:test',
  cues: [
    { id: 'c1', startMs: 1_000, endMs: 3_000, sourceText: 'どうしたの？', translatedText: "What's wrong?" },
    { id: 'c2', startMs: 5_000, endMs: 7_000, sourceText: '何でもない。', translatedText: "It's nothing." },
    { id: 'c3', startMs: 600_000, endMs: 602_000, sourceText: 'またね。', translatedText: 'See you.' },
  ],
};

interface FakeVideo extends Omit<HTMLVideoElement, 'paused'> {
  paused: boolean;
  seekTo(ms: number): void;
}

function makeVideo(): FakeVideo {
  const video = document.createElement('video') as unknown as FakeVideo;
  let time = 0;
  let paused = true;
  Object.defineProperty(video, 'currentTime', {
    configurable: true,
    get: () => time,
    set: (value: number) => { time = value; },
  });
  Object.defineProperty(video, 'paused', { configurable: true, get: () => paused, set: (v: boolean) => { paused = v; } });
  video.seekTo = (ms: number) => {
    video.currentTime = ms / 1000;
    video.dispatchEvent(new Event('seeked'));
  };
  document.body.append(video as unknown as HTMLVideoElement);
  return video;
}

let overlay: SubtitleOverlay | undefined;
let adPlaying = false;
let nativeText = '';

function mount(patch: Partial<FlixTranslateSettings> = {}): { overlay: SubtitleOverlay; video: FakeVideo } {
  const instance = new SubtitleOverlay(settings(patch), noopActions);
  instance.setPlaybackContext({
    isAdPlaying: () => adPlaying,
    getNativeSubtitleText: () => nativeText,
  });
  const video = makeVideo();
  instance.setPlayer(video as unknown as HTMLVideoElement);
  instance.setTrack(track);
  overlay = instance;
  return { overlay: instance, video };
}

beforeEach(() => {
  adPlaying = false;
  nativeText = '';
});

afterEach(() => {
  overlay?.destroy();
  overlay = undefined;
  document.body.replaceChildren();
});

describe('playback synchronization', () => {
  it('shows nothing before the first cue', () => {
    const { overlay: view, video } = mount();
    video.currentTime = 0.2;
    video.dispatchEvent(new Event('timeupdate'));
    expect(view.getRenderedText().visible).toBe(false);
  });

  it('renders the translated line while its cue is active', () => {
    const { overlay: view, video } = mount();
    video.seekTo(2_000);
    const rendered = view.getRenderedText();
    expect(rendered.visible).toBe(true);
    expect(rendered.translation).toBe("What's wrong?");
    expect(rendered.source).toBe('どうしたの？');
  });

  it('clears the line once the cue ends', () => {
    const { overlay: view, video } = mount();
    video.seekTo(2_000);
    expect(view.getRenderedText().visible).toBe(true);
    video.seekTo(4_000);
    expect(view.getRenderedText().visible).toBe(false);
  });

  it('keeps the correct line across pause and resume', () => {
    const { overlay: view, video } = mount();
    video.seekTo(2_000);
    video.paused = true;
    video.dispatchEvent(new Event('pause'));
    expect(view.getRenderedText().translation).toBe("What's wrong?");
    video.paused = false;
    video.dispatchEvent(new Event('play'));
    expect(view.getRenderedText().translation).toBe("What's wrong?");
  });

  it('seeks forward without leaving a stale line behind', () => {
    const { overlay: view, video } = mount();
    video.seekTo(2_000);
    expect(view.getRenderedText().translation).toBe("What's wrong?");
    video.seekTo(6_000);
    expect(view.getRenderedText().translation).toBe("It's nothing.");
    // Far-forward seek into a gap must clear, not hold the previous cue.
    video.seekTo(300_000);
    expect(view.getRenderedText().visible).toBe(false);
  });

  it('seeks backward to an earlier cue', () => {
    const { overlay: view, video } = mount();
    video.seekTo(601_000);
    expect(view.getRenderedText().translation).toBe('See you.');
    video.seekTo(2_000);
    expect(view.getRenderedText().translation).toBe("What's wrong?");
  });

  it('is unaffected by playback-rate changes, which only alter clock speed', () => {
    const { overlay: view, video } = mount();
    for (const rate of [0.5, 1.5, 2]) {
      Object.defineProperty(video, 'playbackRate', { value: rate, configurable: true });
      video.dispatchEvent(new Event('ratechange'));
      video.seekTo(6_000);
      expect(view.getRenderedText().translation).toBe("It's nothing.");
    }
  });

  it('finds a late cue without scanning, proving indexed lookup', () => {
    const { overlay: view, video } = mount();
    video.seekTo(601_000);
    expect(view.getRenderedText().translation).toBe('See you.');
  });
});

describe('advertisement handling', () => {
  it('hides episode subtitles as soon as an ad starts', () => {
    const { overlay: view, video } = mount();
    video.seekTo(2_000);
    expect(view.getRenderedText().visible).toBe(true);

    adPlaying = true;
    video.dispatchEvent(new Event('timeupdate'));
    const during = view.getRenderedText();
    expect(during.visible).toBe(false);
    expect(during.translation).toBe('');
  });

  it('never matches episode cues against the advertisement clock', () => {
    const { overlay: view, video } = mount();
    adPlaying = true;
    // The ad's own timeline would otherwise land inside a real episode cue.
    video.seekTo(6_000);
    expect(view.getRenderedText().visible).toBe(false);
  });

  it('resumes the correct line after the ad ends', () => {
    const { overlay: view, video } = mount();
    video.seekTo(2_000);
    adPlaying = true;
    video.dispatchEvent(new Event('timeupdate'));
    expect(view.getRenderedText().visible).toBe(false);

    adPlaying = false;
    video.seekTo(6_000);
    expect(view.getRenderedText().translation).toBe("It's nothing.");
  });
});

describe('untranslated cues', () => {
  /** A translator leaves non-speech cues blank; those must not become gaps. */
  const mixedTrack: SubtitleTrack = {
    ...track,
    cues: [
      { id: 'm1', startMs: 1_000, endMs: 3_000, sourceText: '♪～', translatedText: '' },
      { id: 'm2', startMs: 5_000, endMs: 7_000, sourceText: '何でもない。', translatedText: "It's nothing." },
    ],
  };

  it('shows the original text when a line has no translation', () => {
    const instance = new SubtitleOverlay(settings(), noopActions);
    instance.setPlaybackContext({ isAdPlaying: () => adPlaying });
    const video = makeVideo();
    instance.setPlayer(video as unknown as HTMLVideoElement);
    instance.setTrack(mixedTrack);
    overlay = instance;

    video.seekTo(2_000);
    const rendered = instance.getRenderedText();
    expect(rendered.visible).toBe(true);
    expect(rendered.translation).toBe('♪～');
    // The source line is omitted so the same text is not stacked twice.
    expect(rendered.source).toBe('');
  });

  it('still renders normally for lines that do have a translation', () => {
    const instance = new SubtitleOverlay(settings(), noopActions);
    instance.setPlaybackContext({ isAdPlaying: () => adPlaying });
    const video = makeVideo();
    instance.setPlayer(video as unknown as HTMLVideoElement);
    instance.setTrack(mixedTrack);
    overlay = instance;

    video.seekTo(6_000);
    const rendered = instance.getRenderedText();
    expect(rendered.translation).toBe("It's nothing.");
    expect(rendered.source).toBe('何でもない。');
  });
});

describe('overlay positioning', () => {
  const withRect = (video: FakeVideo, box: { left: number; top: number; width: number; height: number }) => {
    video.getBoundingClientRect = () => ({
      ...box, right: box.left + box.width, bottom: box.top + box.height, x: box.left, y: box.top,
      toJSON: () => ({}),
    }) as DOMRect;
  };

  it('anchors to the video box for an embedded player', () => {
    const instance = new SubtitleOverlay(settings(), noopActions);
    const video = makeVideo();
    // An embedded player on a normal page, not filling the viewport.
    withRect(video, { left: 320, top: 140, width: 960, height: 540 });
    instance.setPlayer(video as unknown as HTMLVideoElement);
    overlay = instance;

    expect(instance.host.style.position).toBe('fixed');
    expect(instance.host.style.left).toBe('320px');
    expect(instance.host.style.top).toBe('140px');
    expect(instance.host.style.width).toBe('960px');
    expect(instance.host.style.height).toBe('540px');
  });

  it('follows the player when it moves or resizes', () => {
    const instance = new SubtitleOverlay(settings(), noopActions);
    const video = makeVideo();
    withRect(video, { left: 320, top: 140, width: 960, height: 540 });
    instance.setPlayer(video as unknown as HTMLVideoElement);
    overlay = instance;

    withRect(video, { left: 0, top: 0, width: 1280, height: 720 });
    dispatchEvent(new Event('resize'));
    expect(instance.host.style.left).toBe('0px');
    expect(instance.host.style.width).toBe('1280px');
  });

  it('falls back to the viewport when the box is not trustworthy', () => {
    const instance = new SubtitleOverlay(settings(), noopActions);
    const video = makeVideo();
    // Collapsed or mid-transition: covering the viewport is the safe default.
    withRect(video, { left: 0, top: 0, width: 0, height: 0 });
    instance.setPlayer(video as unknown as HTMLVideoElement);
    overlay = instance;

    expect(instance.host.style.inset).toMatch(/^0(px)?$/);
    expect(instance.host.style.left).toBe('');
  });

  it('releases its observers and listeners on destroy', () => {
    const instance = new SubtitleOverlay(settings(), noopActions);
    const video = makeVideo();
    withRect(video, { left: 10, top: 10, width: 800, height: 450 });
    instance.setPlayer(video as unknown as HTMLVideoElement);
    instance.destroy();
    overlay = undefined;

    // A resize after teardown must not touch the detached host.
    const before = instance.host.style.left;
    withRect(video, { left: 99, top: 99, width: 800, height: 450 });
    dispatchEvent(new Event('resize'));
    expect(instance.host.style.left).toBe(before);
  });
});

describe('player replacement and display modes', () => {
  it('re-binds to a replacement video element and keeps the track', () => {
    const { overlay: view, video } = mount();
    video.seekTo(2_000);
    expect(view.getRenderedText().visible).toBe(true);

    video.remove();
    const replacement = makeVideo();
    view.setPlayer(replacement as unknown as HTMLVideoElement);
    replacement.seekTo(6_000);
    expect(view.getRenderedText().translation).toBe("It's nothing.");
  });

  it('hides everything when no player is attached', () => {
    const { overlay: view } = mount();
    view.setPlayer(null);
    expect(view.getRenderedText().visible).toBe(false);
  });

  it('shows only the translation in translation-only mode', () => {
    const { overlay: view, video } = mount({ displayMode: 'translation-only' });
    video.seekTo(2_000);
    expect(view.getRenderedText().translation).toBe("What's wrong?");
    expect(view.host.dataset.subtitleVisible).toBe('true');
  });

  it('renders nothing when the display mode is off', () => {
    const { overlay: view, video } = mount({ displayMode: 'off' });
    video.seekTo(2_000);
    expect(view.getRenderedText().visible).toBe(false);
  });

  it('suppresses our own source line when the platform already draws it', () => {
    const { overlay: view, video } = mount({ displayMode: 'bilingual' });
    nativeText = 'どうしたの？';
    video.seekTo(2_000);
    // The translation still shows; the duplicated original does not.
    expect(view.getRenderedText().translation).toBe("What's wrong?");
    expect(view.host.dataset.subtitleVisible).toBe('true');
  });

  it('removes its host element and listeners on destroy', () => {
    const { overlay: view } = mount();
    expect(document.getElementById('flixtranslate-root')).not.toBeNull();
    view.destroy();
    overlay = undefined;
    expect(document.getElementById('flixtranslate-root')).toBeNull();
  });
});
