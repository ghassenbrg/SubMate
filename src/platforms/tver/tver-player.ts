import {
  isAdVideo as isAdVideoIn,
  isAdvertisementPlaying as isAdPlayingIn,
  pickContentVideo as pickContentVideoIn,
  readAdSignals as readAdSignalsIn,
  type AdSelectorConfig,
  type AdStateSignals,
} from '../../core/playback/ad-signals';

/**
 * TVer plays advertisements through the Google IMA SDK, which renders into its
 * own container and usually its own media element. No single class name is
 * relied upon: the shared detector combines several independent signals so a
 * markup change degrades the heuristic instead of breaking subtitles outright.
 */
export const TVER_AD_SELECTORS: AdSelectorConfig = {
  containers: [
    '.ima-ad-container',
    '.video-js .vjs-ad-container',
    '[class*="ad-container"]',
    '[class*="adContainer"]',
    '[id*="ad-container"]',
    '[class*="ima-container"]',
  ],
  states: [
    '.vjs-ad-playing',
    '.vjs-ad-loading',
    '.ad-playing',
    '[class*="isAdPlaying"]',
    '[data-ad-playing="true"]',
  ],
};

export const isAdVideo = (video: HTMLVideoElement): boolean => isAdVideoIn(video, TVER_AD_SELECTORS);

export const pickContentVideo = (candidates: HTMLVideoElement[]): HTMLVideoElement | null =>
  pickContentVideoIn(candidates, TVER_AD_SELECTORS);

export const readAdSignals = (contentVideo: HTMLVideoElement | undefined): AdStateSignals =>
  readAdSignalsIn(contentVideo, TVER_AD_SELECTORS);

export const isAdvertisementPlaying = (contentVideo: HTMLVideoElement | undefined): boolean =>
  isAdPlayingIn(contentVideo, TVER_AD_SELECTORS);

export type { AdStateSignals };
