/**
 * Platform-independent advertisement detection.
 *
 * Every supported service that inserts ads client-side does so the same way:
 * a dedicated container, its own media element, and a state class on the player
 * root. Only the selectors differ, so they are supplied per platform while the
 * decision logic stays here — a new platform contributes a list, not a copy of
 * this file.
 */

export interface AdSelectorConfig {
  /** Elements that wrap advertisement playback. */
  containers: string[];
  /** Elements whose presence asserts an ad state outright. */
  states: string[];
}

const join = (selectors: string[]): string => selectors.join(',');

/** Querying is guarded: a hostile or unusual page must not break playback. */
const queryAll = (selectors: string[]): HTMLElement[] => {
  if (!selectors.length) return [];
  try {
    return [...document.querySelectorAll<HTMLElement>(join(selectors))];
  } catch {
    return [];
  }
};

const isRendered = (element: Element): boolean => {
  const node = element as HTMLElement;
  const rect = node.getBoundingClientRect?.();
  if (!rect || rect.width < 2 || rect.height < 2) return false;
  const style = getComputedStyle(node);
  return style.display !== 'none' && style.visibility !== 'hidden' && style.opacity !== '0';
};

/** True when a media element sits inside an advertisement container. */
export function isAdVideo(video: HTMLVideoElement, config: AdSelectorConfig): boolean {
  if (!config.containers.length) return false;
  try {
    return Boolean(video.closest(join(config.containers)));
  } catch {
    return false;
  }
}

const score = (video: HTMLVideoElement): number => {
  let value = 0;
  if (Number.isFinite(video.duration) && video.duration > 0) value += 4;
  if (video.readyState > 0) value += 2;
  if (!video.paused) value += 2;
  if (video.currentSrc) value += 1;
  return value;
};

/**
 * Chooses the element presenting episode content.
 *
 * Advertisement media is excluded first; among the rest the one with real
 * duration wins, because a player can keep a detached or not-yet-loaded element
 * in the DOM alongside the live one.
 */
export function pickContentVideo(
  candidates: HTMLVideoElement[],
  config: AdSelectorConfig,
): HTMLVideoElement | null {
  const content = candidates.filter((video) => !isAdVideo(video, config));
  if (!content.length) return null;
  return [...content].sort((a, b) => score(b) - score(a))[0] ?? null;
}

export interface AdStateSignals {
  adContainerVisible: boolean;
  adStateClass: boolean;
  adVideoPlaying: boolean;
}

/** Collects each independent advertisement signal, for decisions and logging. */
export function readAdSignals(
  contentVideo: HTMLVideoElement | undefined,
  config: AdSelectorConfig,
): AdStateSignals {
  return {
    adContainerVisible: queryAll(config.containers).some(isRendered),
    adStateClass: queryAll(config.states).some(isRendered),
    adVideoPlaying: queryAll(['video']).some((element) => {
      const video = element as HTMLVideoElement;
      return video !== contentVideo && isAdVideo(video, config) && !video.paused && video.currentTime > 0;
    }),
  };
}

/**
 * True when an advertisement is presenting instead of content.
 *
 * Any single strong signal suffices: showing episode dialogue over an
 * advertisement is a worse failure than briefly withholding subtitles.
 */
export function isAdvertisementPlaying(
  contentVideo: HTMLVideoElement | undefined,
  config: AdSelectorConfig,
): boolean {
  const signals = readAdSignals(contentVideo, config);
  return signals.adStateClass || signals.adVideoPlaying || signals.adContainerVisible;
}
