/**
 * TVer page detection.
 *
 * Hostname is the only hard requirement. Route shape is treated as a hint
 * rather than a rule, because TVer has changed its routing before and an
 * episode can also be presented by an in-page player.
 */
export const isTVerHost = (url: URL): boolean =>
  url.hostname === 'tver.jp' || url.hostname.endsWith('.tver.jp');

const EPISODE_PATH = /^\/episodes\/([A-Za-z0-9_-]{1,64})/;

/** Episode identifier implied by the current route, if the route carries one. */
export const routeEpisodeId = (pathname = location.pathname): string | undefined =>
  EPISODE_PATH.exec(pathname)?.[1];

/**
 * True when the page looks like playback rather than browsing. A media element
 * is the decisive runtime signal; the route only corroborates it.
 */
export const looksLikePlaybackPage = (): boolean =>
  Boolean(routeEpisodeId()) || document.querySelector('video') !== null;
