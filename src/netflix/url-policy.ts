import { FlixTranslateError } from '../shared-errors';

const NETFLIX_RESOURCE_SUFFIXES = [
  'netflix.com',
  'nflxvideo.net',
  'nflxso.net',
  'nflxext.com',
] as const;

export function isAllowedNetflixSubtitleUrl(value: string): boolean {
  try {
    const url = new URL(value);
    if (url.protocol !== 'https:' || url.username || url.password) return false;
    const host = url.hostname.toLowerCase();
    return NETFLIX_RESOURCE_SUFFIXES.some(
      (suffix) => host === suffix || host.endsWith(`.${suffix}`),
    );
  } catch {
    return false;
  }
}

export function assertAllowedNetflixSubtitleUrl(value: string): URL {
  if (!isAllowedNetflixSubtitleUrl(value)) {
    throw new FlixTranslateError('SUBTITLE_DOWNLOAD_FAILED', 'Rejected untrusted subtitle URL');
  }
  return new URL(value);
}
