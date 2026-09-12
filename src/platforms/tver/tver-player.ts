/**
 * TVer player heuristics: distinguishing the content video from advertisement
 * playback, and choosing the element whose clock our subtitle timeline follows.
 *
 * TVer plays ads through the Google IMA SDK, which renders into its own
 * container and usually its own media element. No single class name is relied
 * upon: several independent signals are combined so a markup change degrades
 * the heuristic instead of breaking subtitles outright.
 */

/** Containers IMA and Video.js-family players use for advertisement playback. */
const AD_CONTAINER_SELECTORS = [
  '.ima-ad-container',
  '.video-js .vjs-ad-container',
  '[class*="ad-container"]',
  '[class*="adContainer"]',
  '[id*="ad-container"]',
  '[class*="ima-container"]',
].join(',');

/** Player-root classes that assert an ad state outright. */
const AD_STATE_SELECTORS = [
  '.vjs-ad-playing',
  '.vjs-ad-loading',
  '.ad-playing',
  '[class*="isAdPlaying"]',
  '[data-ad-playing="true"]',
].join(',');

const isRendered = (element: Element): boolean => {
  const node = element as HTMLElement;
  const rect = node.getBoundingClientRect?.();
  if (!rect || rect.width < 2 || rect.height < 2) return false;
  const style = getComputedStyle(node);
  return style.display !== 'none' && style.visibility !== 'hidden' && style.opacity !== '0';
};

const queryAll = (selectors: string): HTMLElement[] => {
  try {
    return [...document.querySelectorAll<HTMLElement>(selectors)];
  } catch {
    return [];
  }
};

/** True when a media element sits inside an advertisement container. */
export function isAdVideo(video: HTMLVideoElement): boolean {
  try {
    return Boolean(video.closest(AD_CONTAINER_SELECTORS));
  } catch {
    return false;
  }
}

/**
 * Chooses the element presenting episode content.
 *
 * Ad media elements are excluded first; among the rest the one with real
 * duration is preferred, because TVer can keep a detached or not-yet-loaded
 * element in the DOM alongside the live one.
 */
export function pickContentVideo(candidates: HTMLVideoElement[]): HTMLVideoElement | null {
  const contentCandidates = candidates.filter((video) => !isAdVideo(video));
  if (!contentCandidates.length) return null;
  const scored = [...contentCandidates].sort((a, b) => score(b) - score(a));
  return scored[0] ?? null;
}

const score = (video: HTMLVideoElement): number => {
  let value = 0;
  if (Number.isFinite(video.duration) && video.duration > 0) value += 4;
  if (video.readyState > 0) value += 2;
  if (!video.paused) value += 2;
  if (video.currentSrc) value += 1;
  return value;
};

export interface AdStateSignals {
  adContainerVisible: boolean;
  adStateClass: boolean;
  adVideoPlaying: boolean;
}

/** Collects each independent advertisement signal for logging and decisions. */
export function readAdSignals(contentVideo: HTMLVideoElement | undefined): AdStateSignals {
  const adContainerVisible = queryAll(AD_CONTAINER_SELECTORS).some(isRendered);
  const adStateClass = queryAll(AD_STATE_SELECTORS).some(isRendered);
  const adVideoPlaying = queryAll('video').some(
    (element) => {
      const video = element as HTMLVideoElement;
      return video !== contentVideo && isAdVideo(video) && !video.paused && video.currentTime > 0;
    },
  );
  return { adContainerVisible, adStateClass, adVideoPlaying };
}

/**
 * True when an advertisement is presenting instead of episode content.
 *
 * Any one strong signal is enough: showing episode dialogue over an ad is a
 * worse failure than briefly withholding subtitles.
 */
export function isAdvertisementPlaying(contentVideo: HTMLVideoElement | undefined): boolean {
  const signals = readAdSignals(contentVideo);
  return signals.adStateClass || signals.adVideoPlaying || signals.adContainerVisible;
}
