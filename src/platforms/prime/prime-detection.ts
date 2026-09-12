/**
 * Prime Video detection.
 *
 * Prime Video is served both from primevideo.com and from every regional
 * amazon.* storefront under a video path, so hostname alone is neither
 * sufficient nor safe — matching all of amazon.com would put this extension on
 * the entire shop.
 */
const PRIME_HOSTS = /(?:^|\.)primevideo\.com$/;
const AMAZON_HOSTS = /(?:^|\.)amazon\.[a-z]{2,3}(?:\.[a-z]{2,3})?$/;

/** Video areas of an Amazon storefront; everything else is the shop. */
const AMAZON_VIDEO_PATH = /^\/(?:gp\/video|Amazon-Video|dp\/[A-Za-z0-9]+\/?(?:\?.*)?$)/;

export function isPrimeVideoUrl(url: URL): boolean {
  const host = url.hostname.toLowerCase();
  if (PRIME_HOSTS.test(host)) return true;
  return AMAZON_HOSTS.test(host) && AMAZON_VIDEO_PATH.test(url.pathname);
}

/**
 * Amazon title identifier (ASIN / GTI) implied by the current location.
 *
 * Several route shapes carry it, and playback can also be reached with the id
 * only in the query string, so each known carrier is checked in turn.
 */
export function routeContentId(href: string = location.href): string | undefined {
  let url: URL;
  try {
    url = new URL(href);
  } catch {
    return undefined;
  }
  const valid = (value: string | null | undefined): string | undefined =>
    value && /^[A-Za-z0-9._-]{6,64}$/.test(value) ? value : undefined;

  const fromQuery =
    valid(url.searchParams.get('asin')) ??
    valid(url.searchParams.get('gti')) ??
    valid(url.searchParams.get('titleId'));
  if (fromQuery) return fromQuery;

  const path = url.pathname;
  const patterns = [
    /\/detail\/([A-Za-z0-9._-]{6,64})/,
    /\/gp\/video\/detail\/([A-Za-z0-9._-]{6,64})/,
    /\/dp\/([A-Za-z0-9._-]{6,64})/,
  ];
  for (const pattern of patterns) {
    const match = pattern.exec(path);
    if (match?.[1]) return match[1];
  }
  return undefined;
}
