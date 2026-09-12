import { SubMateError } from '../../shared-errors';

/**
 * Hosts Amazon serves Prime Video sidecar subtitles from.
 *
 * Subtitle files are ordinary timed-text documents delivered alongside the
 * stream; they are not part of the DRM-protected media. Restricting fetches to
 * Amazon-owned hosts keeps a tampered or injected playback payload from
 * steering the extension at an unrelated origin.
 */
const AMAZON_RESOURCE_SUFFIXES = [
  'primevideo.com',
  'media-amazon.com',
  'amazonvideo.com',
  'aiv-cdn.net',
  'aiv-delivery.net',
  // Observed during authorized Prime Video playback on 2026-09-12. Amazon's
  // timed-text service uses regional hosts below this suffix (for example,
  // cf-timedtext.aux.pv-cdn.net), rather than CloudFront.
  'pv-cdn.net',
  'images-amazon.com',
  'ssl-images-amazon.com',
  // Amazon fronts video assets through CloudFront, so excluding it rejects the
  // real subtitle hosts and breaks discovery outright. This is a deliberate
  // trade: the download happens in the page realm with credentials omitted and
  // is only ever parsed as timed text, so the allowlist is defence in depth
  // rather than the control that keeps the extension safe.
  'cloudfront.net',
] as const;

/** Matches amazon.com, amazon.co.jp, amazon.de and the other regional stores. */
const AMAZON_REGIONAL = /(?:^|\.)amazon\.[a-z]{2,3}(?:\.[a-z]{2,3})?$/;

export function isAllowedPrimeSubtitleUrl(value: string): boolean {
  try {
    const url = new URL(value);
    if (url.protocol !== 'https:' || url.username || url.password) return false;
    const host = url.hostname.toLowerCase();
    if (AMAZON_REGIONAL.test(host)) return true;
    return AMAZON_RESOURCE_SUFFIXES.some((suffix) => host === suffix || host.endsWith(`.${suffix}`));
  } catch {
    return false;
  }
}

export function assertAllowedPrimeSubtitleUrl(value: string): URL {
  if (!isAllowedPrimeSubtitleUrl(value)) {
    throw new SubMateError('SUBTITLE_DOWNLOAD_FAILED', 'Rejected untrusted subtitle URL');
  }
  return new URL(value);
}
