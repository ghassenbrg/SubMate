import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { AdapterHost } from '../../src/platforms/types';
import { defaultSettings } from '../../src/settings/defaults';
import type { SubMateSettings } from '../../src/settings/schema';
import type { PrimePlaybackSnapshot } from '../../src/platforms/prime/prime-manifest';

const mocks = vi.hoisted(() => ({
  handlers: undefined as undefined | { onPlayback(s: PrimePlaybackSnapshot): void; onNavigation(id?: string): void },
  stopBridge: vi.fn(),
  requestSubtitle: vi.fn(),
}));

vi.mock('../../src/platforms/prime/prime-bridge', () => ({
  startPrimeBridge: (handlers: never) => { mocks.handlers = handlers; return mocks.stopBridge; },
  requestPrimeSubtitle: (...args: unknown[]) => mocks.requestSubtitle(...args),
}));

import { PrimeVideoAdapter } from '../../src/platforms/prime/prime-adapter';

const settings = (patch: Partial<SubMateSettings> = {}): SubMateSettings => ({
  ...defaultSettings(), preferredTargetLanguage: 'ar', ...patch,
});

const snapshot = (contentId = 'B0ABCD1234'): PrimePlaybackSnapshot => ({
  protocolVersion: 1, contentId, capturedAt: Date.now(), audioLanguage: 'ja',
  subtitles: [
    { url: '', language: 'ja', label: '日本語', forced: false },
    { url: '', language: 'ja', label: 'Forced', forced: true },
    { url: '', language: 'en', label: 'English', forced: false },
  ],
});

function makeHost(): AdapterHost & { events: string[] } {
  const events: string[] = [];
  return {
    events,
    onContentChanged: (id) => events.push(`content:${id ?? 'none'}`),
    onSourceAvailabilityChanged: () => events.push('availability'),
    onVideoChanged: (v) => events.push(`video:${v ? 'present' : 'none'}`),
    onAdStateChanged: (ad) => events.push(`ad:${ad}`),
    debug: () => undefined,
  };
}

const addVideo = () => {
  const video = document.createElement('video');
  Object.defineProperty(video, 'duration', { value: 3600, configurable: true });
  Object.defineProperty(video, 'readyState', { value: 4, configurable: true });
  document.body.append(video);
  return video;
};

const ttml = (text: string) =>
  `<tt xmlns="http://www.w3.org/ns/ttml"><body><div><p begin="10000000" end="20000000">${text}</p></div></body></tt>`;

beforeEach(() => {
  mocks.handlers = undefined;
  mocks.stopBridge.mockReset();
  mocks.requestSubtitle.mockReset();
  history.replaceState({}, '', '/detail/B0ABCD1234');
});

afterEach(() => {
  document.body.replaceChildren();
  vi.useRealTimers();
});

describe('Prime adapter', () => {
  it('declares full capabilities including ad detection', () => {
    expect(new PrimeVideoAdapter().capabilities).toMatchObject({
      supportsOriginalSubtitles: true, supportsFullEpisodeExtraction: true,
      supportsEpisodeDetection: true, supportsAdDetection: true,
    });
  });

  it('waits until a playback payload has been observed', () => {
    const adapter = new PrimeVideoAdapter();
    adapter.start(makeHost());
    expect(adapter.selectSource(settings()).kind).toBe('pending');
    adapter.stop();
  });

  it('selects the full Japanese track once playback resolves', () => {
    const adapter = new PrimeVideoAdapter();
    const host = makeHost();
    adapter.start(host);
    mocks.handlers?.onPlayback(snapshot());
    const selection = adapter.selectSource(settings());
    expect(selection.kind).toBe('ready');
    if (selection.kind === 'ready') {
      expect(selection.language).toBe('ja');
      // Forced-narrative tracks carry only signage, never full dialogue.
      expect(selection.trackId).not.toContain('forced');
    }
    expect(host.events).toContain('content:B0ABCD1234');
    adapter.stop();
  });

  it('skips translation when Amazon already offers the target language', () => {
    const adapter = new PrimeVideoAdapter();
    adapter.start(makeHost());
    mocks.handlers?.onPlayback(snapshot());
    expect(adapter.selectSource(settings({ preferredTargetLanguage: 'en' })).kind).toBe('target-available');
    adapter.stop();
  });

  it('ignores a payload resolved for a different title', () => {
    const adapter = new PrimeVideoAdapter();
    const host = makeHost();
    adapter.start(host);
    // Prime resolves playback for recommendations and next-episode preloads.
    mocks.handlers?.onPlayback(snapshot('B0OTHER999'));
    expect(adapter.selectSource(settings()).kind).toBe('pending');
    expect(host.events).not.toContain('content:B0OTHER999');
    adapter.stop();
  });

  it('parses the downloaded timed-text document into cues', async () => {
    mocks.requestSubtitle.mockResolvedValue({ text: ttml('こんにちは'), contentType: 'application/ttml+xml' });
    const adapter = new PrimeVideoAdapter();
    adapter.start(makeHost());
    mocks.handlers?.onPlayback(snapshot());
    const selection = adapter.selectSource(settings());
    if (selection.kind !== 'ready') throw new Error('expected a ready selection');
    const extracted = await adapter.extractSource(selection, new AbortController().signal);
    expect(extracted.language).toBe('ja');
    expect(extracted.cues).toHaveLength(1);
    expect(extracted.cues[0]?.sourceText).toBe('こんにちは');
    // The track is addressed by language, never by a signed URL.
    expect(mocks.requestSubtitle).toHaveBeenCalledWith('B0ABCD1234', 'ja', false, expect.any(AbortSignal));
    adapter.stop();
  });

  it('follows SPA navigation to another title', () => {
    const adapter = new PrimeVideoAdapter();
    const host = makeHost();
    adapter.start(host);
    mocks.handlers?.onPlayback(snapshot());
    expect(adapter.selectSource(settings()).kind).toBe('ready');

    history.replaceState({}, '', '/detail/B0NEXT5678');
    mocks.handlers?.onNavigation('B0NEXT5678');
    expect(host.events).toContain('content:B0NEXT5678');
    // Discovery restarts rather than reusing the previous title's tracks.
    expect(adapter.selectSource(settings()).kind).toBe('pending');
    adapter.stop();
  });

  it('reports ad state on transition and hides nothing otherwise', async () => {
    vi.useFakeTimers();
    const adapter = new PrimeVideoAdapter();
    const host = makeHost();
    addVideo();
    adapter.start(host);
    expect(adapter.isAdPlaying()).toBe(false);

    const container = document.createElement('div');
    container.className = 'atvwebplayersdk-adtimer-text';
    container.getBoundingClientRect = () => ({ width: 200, height: 40 }) as DOMRect;
    document.body.append(container);
    await vi.advanceTimersByTimeAsync(500);
    expect(adapter.isAdPlaying()).toBe(true);
    expect(host.events.filter((e) => e === 'ad:true')).toHaveLength(1);

    container.remove();
    await vi.advanceTimersByTimeAsync(500);
    expect(adapter.isAdPlaying()).toBe(false);
    adapter.stop();
  });

  it('releases bridge and timers on stop', async () => {
    vi.useFakeTimers();
    const adapter = new PrimeVideoAdapter();
    const host = makeHost();
    addVideo();
    adapter.start(host);
    adapter.stop();
    expect(mocks.stopBridge).toHaveBeenCalled();
    const before = host.events.length;
    const container = document.createElement('div');
    container.className = 'atvwebplayersdk-adtimer-text';
    container.getBoundingClientRect = () => ({ width: 200, height: 40 }) as DOMRect;
    document.body.append(container);
    await vi.advanceTimersByTimeAsync(20_000);
    expect(host.events.length).toBe(before);
  });
});
