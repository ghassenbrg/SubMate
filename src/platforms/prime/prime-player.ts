import {
  isAdvertisementPlaying as isAdPlayingIn,
  pickContentVideo as pickContentVideoIn,
  readAdSignals as readAdSignalsIn,
  type AdSelectorConfig,
  type AdStateSignals,
} from '../../core/playback/ad-signals';

/**
 * Prime Video's web player namespaces its own elements with an
 * `atvwebplayersdk-` prefix, which is a far more stable signal than a generic
 * class name. Broader patterns are kept alongside it so detection degrades
 * rather than disappears if that prefix changes.
 */
export const PRIME_AD_SELECTORS: AdSelectorConfig = {
  containers: [
    '[class*="atvwebplayersdk-ad"]',
    '[class*="adContainer"]',
    '[class*="ad-container"]',
    '[id*="ad-container"]',
    '[data-testid*="ad-container"]',
  ],
  states: [
    '[class*="atvwebplayersdk-adtimer"]',
    '[class*="atvwebplayersdk-ad-timer"]',
    '[class*="adPlaying"]',
    '[data-testid*="ad-timer"]',
    '[data-ad-playing="true"]',
  ],
};

export const pickContentVideo = (candidates: HTMLVideoElement[]): HTMLVideoElement | null =>
  pickContentVideoIn(candidates, PRIME_AD_SELECTORS);

export const readAdSignals = (contentVideo: HTMLVideoElement | undefined): AdStateSignals =>
  readAdSignalsIn(contentVideo, PRIME_AD_SELECTORS);

export const isAdvertisementPlaying = (contentVideo: HTMLVideoElement | undefined): boolean =>
  isAdPlayingIn(contentVideo, PRIME_AD_SELECTORS);
