import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { AdapterHost } from '../../src/platforms/types';
import { defaultSettings } from '../../src/settings/defaults';
import type { FlixTranslateSettings } from '../../src/settings/schema';

const mocks = vi.hoisted(() => ({
  bridgeHandlers: undefined as undefined | { onManifestObserved(count: number): void; onNavigation(id?: string): void },
  stopBridge: vi.fn(),
  requestSubtitles: vi.fn(),
}));

vi.mock('../../src/platforms/tver/tver-bridge', () => ({
  startTVerBridge: (handlers: never) => {
    mocks.bridgeHandlers = handlers;
    return mocks.stopBridge;
  },
  requestTVerSubtitles: (...args: unknown[]) => mocks.requestSubtitles(...args),
}));

import { TVerAdapter } from '../../src/platforms/tver/tver-adapter';

const settings = (patch: Partial<FlixTranslateSettings> = {}): FlixTranslateSettings => ({
  ...defaultSettings(),
  preferredTargetLanguage: 'en',
  ...patch,
});

function makeHost(): AdapterHost & { events: string[] } {
  const events: string[] = [];
  return {
    events,
    onContentChanged: (id) => events.push(`content:${id ?? 'none'}`),
    onSourceAvailabilityChanged: () => events.push('availability'),
    onVideoChanged: (video) => events.push(`video:${video ? 'present' : 'none'}`),
    onAdStateChanged: (ad) => events.push(`ad:${ad}`),
    debug: () => undefined,
  };
}

const addVideo = () => {
  const video = document.createElement('video');
  Object.defineProperty(video, 'duration', { value: 1800, configurable: true });
  Object.defineProperty(video, 'readyState', { value: 4, configurable: true });
  document.body.append(video);
  return video;
};

const nextTick = () => new Promise((resolve) => setTimeout(resolve, 0));

beforeEach(() => {
  mocks.bridgeHandlers = undefined;
  mocks.stopBridge.mockReset();
  mocks.requestSubtitles.mockReset();
  history.replaceState({}, '', '/episodes/epabc123');
});

afterEach(() => {
  document.body.replaceChildren();
  vi.useRealTimers();
});

describe('TVer detection', () => {
  it('matches tver.jp and its subdomains only', () => {
    const adapter = new TVerAdapter();
    expect(adapter.matches(new URL('https://tver.jp/episodes/abc'))).toBe(true);
    expect(adapter.matches(new URL('https://www.tver.jp/'))).toBe(true);
    expect(adapter.matches(new URL('https://www.netflix.com/watch/1'))).toBe(false);
    // A lookalike host must not be treated as TVer.
    expect(adapter.matches(new URL('https://nottver.jp/'))).toBe(false);
  });

  it('derives the episode id from the route rather than a media URL', () => {
    const adapter = new TVerAdapter();
    expect(adapter.getContentId()).toBe('epabc123');
  });

  it('declares full capabilities including ad detection', () => {
    expect(new TVerAdapter().capabilities).toMatchObject({
      supportsOriginalSubtitles: true,
      supportsFullEpisodeExtraction: true,
      supportsEpisodeDetection: true,
      supportsAdDetection: true,
    });
  });
});

describe('TVer source selection', () => {
  it('waits while no player or manifest has appeared yet', () => {
    const adapter = new TVerAdapter();
    adapter.start(makeHost());
    expect(adapter.selectSource(settings()).kind).toBe('pending');
    adapter.stop();
  });

  it('becomes ready once a video exists and a manifest was observed', async () => {
    const adapter = new TVerAdapter();
    const host = makeHost();
    addVideo();
    adapter.start(host);
    await nextTick();
    mocks.bridgeHandlers?.onManifestObserved(1);
    const selection = adapter.selectSource(settings());
    expect(selection.kind).toBe('ready');
    if (selection.kind === 'ready') {
      expect(selection.language).toBe('ja');
      // The timeline version is part of the track id so that improving
      // extraction retires previously cached tracks for the same episode.
      expect(selection.trackId).toBe('tver:epabc123:ja:v2');
    }
    expect(host.events).toContain('availability');
    adapter.stop();
  });

  it('reports the target as already available when translating into Japanese', async () => {
    const adapter = new TVerAdapter();
    addVideo();
    adapter.start(makeHost());
    await nextTick();
    mocks.bridgeHandlers?.onManifestObserved(1);
    expect(adapter.selectSource(settings({ preferredTargetLanguage: 'ja-JP' })).kind).toBe('target-available');
    adapter.stop();
  });

  it('attempts extraction anyway once the manifest grace period elapses', async () => {
    vi.useFakeTimers();
    const adapter = new TVerAdapter();
    const host = makeHost();
    addVideo();
    adapter.start(host);
    expect(adapter.selectSource(settings()).kind).toBe('pending');
    await vi.advanceTimersByTimeAsync(13_000);
    expect(adapter.selectSource(settings()).kind).toBe('ready');
    adapter.stop();
  });
});

describe('TVer extraction', () => {
  it('turns bridge segments into normalized cues', async () => {
    mocks.requestSubtitles.mockResolvedValue({
      track: { language: 'ja-JP', name: '日本語', isDefault: true, forced: false },
      segments: [
        { startMs: 0, text: 'WEBVTT\n\n00:00:01.000 --> 00:00:02.000\nこんにちは\n' },
        { startMs: 10_000, text: 'WEBVTT\n\n00:00:11.000 --> 00:00:12.000\nさようなら\n' },
      ],
      failedSegments: 0,
    });
    const adapter = new TVerAdapter();
    addVideo();
    adapter.start(makeHost());
    const extracted = await adapter.extractSource(
      { kind: 'ready', trackId: 'tver:epabc123:ja', language: 'ja', profile: 'hls-webvtt' },
      new AbortController().signal,
    );
    expect(extracted.language).toBe('ja-JP');
    expect(extracted.cues.map((cue) => cue.sourceText)).toEqual(['こんにちは', 'さようなら']);
    expect(extracted.cues[1]?.startMs).toBe(11_000);
    adapter.stop();
  });

  it('surfaces a partial track when some segments failed', async () => {
    mocks.requestSubtitles.mockResolvedValue({
      track: { language: 'ja', isDefault: true, forced: false },
      segments: [{ startMs: 0, text: 'WEBVTT\n\n00:00:01.000 --> 00:00:02.000\nのこり\n' }],
      failedSegments: 3,
    });
    const adapter = new TVerAdapter();
    adapter.start(makeHost());
    const extracted = await adapter.extractSource(
      { kind: 'ready', trackId: 't', language: 'ja' },
      new AbortController().signal,
    );
    expect(extracted.cues).toHaveLength(1);
    adapter.stop();
  });
});

describe('TVer runtime behaviour', () => {
  it('notifies on SPA episode navigation and resets manifest discovery', async () => {
    const adapter = new TVerAdapter();
    const host = makeHost();
    addVideo();
    adapter.start(host);
    await nextTick();
    mocks.bridgeHandlers?.onManifestObserved(1);
    expect(adapter.selectSource(settings()).kind).toBe('ready');

    history.replaceState({}, '', '/episodes/epnext456');
    mocks.bridgeHandlers?.onNavigation('epnext456');
    expect(adapter.getContentId()).toBe('epnext456');
    expect(host.events).toContain('content:epnext456');
    // Discovery must restart for the new episode rather than reusing old state.
    expect(adapter.selectSource(settings()).kind).toBe('pending');
    adapter.stop();
  });

  it('reports ad state changes once, on transition', async () => {
    vi.useFakeTimers();
    const adapter = new TVerAdapter();
    const host = makeHost();
    addVideo();
    adapter.start(host);
    expect(adapter.isAdPlaying()).toBe(false);

    const container = document.createElement('div');
    container.className = 'ima-ad-container';
    container.getBoundingClientRect = () => ({ width: 640, height: 360 }) as DOMRect;
    document.body.append(container);
    await vi.advanceTimersByTimeAsync(500);
    expect(adapter.isAdPlaying()).toBe(true);
    await vi.advanceTimersByTimeAsync(1_000);
    expect(host.events.filter((event) => event === 'ad:true')).toHaveLength(1);

    container.remove();
    await vi.advanceTimersByTimeAsync(500);
    expect(adapter.isAdPlaying()).toBe(false);
    expect(host.events).toContain('ad:false');
    adapter.stop();
  });

  it('reads native captions through the standard text-track API', () => {
    const adapter = new TVerAdapter();
    const video = addVideo();
    Object.defineProperty(video, 'textTracks', {
      configurable: true,
      value: [{ mode: 'showing', kind: 'subtitles', activeCues: [{ text: 'ネイティブ字幕' }] }],
    });
    adapter.start(makeHost());
    expect(adapter.getNativeSubtitleText()).toBe('ネイティブ字幕');
    adapter.stop();
  });

  it('reports no native captions when the viewer has them switched off', () => {
    const adapter = new TVerAdapter();
    const video = addVideo();
    Object.defineProperty(video, 'textTracks', {
      configurable: true,
      value: [{ mode: 'disabled', kind: 'subtitles', activeCues: [{ text: 'hidden' }] }],
    });
    adapter.start(makeHost());
    expect(adapter.getNativeSubtitleText()).toBe('');
    adapter.stop();
  });

  it('releases every timer and listener on stop', async () => {
    vi.useFakeTimers();
    const adapter = new TVerAdapter();
    const host = makeHost();
    addVideo();
    adapter.start(host);
    adapter.stop();
    expect(mocks.stopBridge).toHaveBeenCalled();
    const before = host.events.length;
    const container = document.createElement('div');
    container.className = 'ima-ad-container';
    container.getBoundingClientRect = () => ({ width: 640, height: 360 }) as DOMRect;
    document.body.append(container);
    await vi.advanceTimersByTimeAsync(20_000);
    // A stopped adapter must not keep polling or emitting.
    expect(host.events.length).toBe(before);
  });
});
