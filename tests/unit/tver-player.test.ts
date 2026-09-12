import { afterEach, describe, expect, it, vi } from 'vitest';
import { isAdVideo, isAdvertisementPlaying, pickContentVideo, readAdSignals } from '../../src/platforms/tver/tver-player';

/** jsdom reports zero-size boxes, so visibility is stubbed per element. */
function sized(element: HTMLElement, width = 640, height = 360): HTMLElement {
  element.getBoundingClientRect = () => ({
    width, height, top: 0, left: 0, right: width, bottom: height, x: 0, y: 0,
    toJSON: () => ({}),
  }) as DOMRect;
  return element;
}

function makeVideo(options: { duration?: number; readyState?: number; paused?: boolean; currentTime?: number; src?: string } = {}): HTMLVideoElement {
  const video = document.createElement('video');
  Object.defineProperty(video, 'duration', { value: options.duration ?? Number.NaN, configurable: true });
  Object.defineProperty(video, 'readyState', { value: options.readyState ?? 0, configurable: true });
  Object.defineProperty(video, 'paused', { value: options.paused ?? true, configurable: true });
  Object.defineProperty(video, 'currentTime', { value: options.currentTime ?? 0, configurable: true, writable: true });
  Object.defineProperty(video, 'currentSrc', { value: options.src ?? '', configurable: true });
  return video;
}

afterEach(() => {
  document.body.replaceChildren();
  vi.restoreAllMocks();
});

describe('content video selection', () => {
  it('ignores media elements inside an advertisement container', () => {
    const adContainer = document.createElement('div');
    adContainer.className = 'ima-ad-container';
    const adVideo = makeVideo({ paused: false, readyState: 4 });
    adContainer.append(adVideo);
    const contentVideo = makeVideo({ duration: 1800, readyState: 4 });
    document.body.append(adContainer, contentVideo);

    expect(isAdVideo(adVideo)).toBe(true);
    expect(isAdVideo(contentVideo)).toBe(false);
    expect(pickContentVideo([adVideo, contentVideo])).toBe(contentVideo);
  });

  it('prefers the element that actually has media loaded', () => {
    const empty = makeVideo();
    const loaded = makeVideo({ duration: 1200, readyState: 4, src: 'blob:x' });
    expect(pickContentVideo([empty, loaded])).toBe(loaded);
  });

  it('returns null when only advertisement media exists', () => {
    const container = document.createElement('div');
    container.className = 'vjs-ad-container';
    const adVideo = makeVideo();
    container.append(adVideo);
    document.body.append(container);
    expect(pickContentVideo([adVideo])).toBeNull();
  });
});

describe('advertisement detection', () => {
  it('reports no ad during ordinary content playback', () => {
    const contentVideo = makeVideo({ duration: 1800, readyState: 4, paused: false });
    document.body.append(contentVideo);
    expect(isAdvertisementPlaying(contentVideo)).toBe(false);
    expect(readAdSignals(contentVideo)).toEqual({
      adContainerVisible: false,
      adStateClass: false,
      adVideoPlaying: false,
    });
  });

  it('detects an ad from a player-root state class alone', () => {
    const root = sized(document.createElement('div'));
    root.className = 'video-js vjs-ad-playing';
    document.body.append(root);
    expect(readAdSignals(undefined).adStateClass).toBe(true);
    expect(isAdvertisementPlaying(undefined)).toBe(true);
  });

  it('detects an ad from a visible ad container alone', () => {
    const container = sized(document.createElement('div'));
    container.className = 'ima-ad-container';
    document.body.append(container);
    expect(readAdSignals(undefined).adContainerVisible).toBe(true);
    expect(isAdvertisementPlaying(undefined)).toBe(true);
  });

  it('ignores an ad container that is present but collapsed', () => {
    const container = document.createElement('div');
    container.className = 'ima-ad-container';
    // Zero-size: IMA leaves the container in the DOM between ad breaks.
    container.getBoundingClientRect = () => ({ width: 0, height: 0 }) as DOMRect;
    document.body.append(container);
    expect(isAdvertisementPlaying(undefined)).toBe(false);
  });

  it('detects a separate ad media element that is playing', () => {
    const container = document.createElement('div');
    container.className = 'ad-container';
    container.getBoundingClientRect = () => ({ width: 0, height: 0 }) as DOMRect;
    const adVideo = makeVideo({ paused: false, currentTime: 3 });
    container.append(adVideo);
    const contentVideo = makeVideo({ duration: 1800 });
    document.body.append(container, contentVideo);
    expect(readAdSignals(contentVideo).adVideoPlaying).toBe(true);
    expect(isAdvertisementPlaying(contentVideo)).toBe(true);
  });

  it('survives an invalid selector environment without throwing', () => {
    vi.spyOn(document, 'querySelectorAll').mockImplementation(() => {
      throw new Error('selector engine unavailable');
    });
    expect(() => isAdvertisementPlaying(undefined)).not.toThrow();
    expect(isAdvertisementPlaying(undefined)).toBe(false);
  });
});
