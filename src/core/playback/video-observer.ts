/**
 * Watches the document for the active media element and reports replacements.
 *
 * Streaming players swap `<video>` during ads, episode changes, player
 * initialization and error recovery. A single MutationObserver on the document
 * root is cheaper and far more robust than per-container observers, and it is
 * disconnected by the returned disposer so no listener outlives the adapter.
 */
export function observeVideoElement(
  selector: string,
  onVideo: (video: HTMLVideoElement | null) => void,
  options: { pickBest?: (candidates: HTMLVideoElement[]) => HTMLVideoElement | null } = {},
): () => void {
  let current: HTMLVideoElement | null = null;
  let stopped = false;

  const inspect = () => {
    if (stopped) return;
    const candidates = [...document.querySelectorAll<HTMLVideoElement>(selector)];
    const candidate = options.pickBest
      ? options.pickBest(candidates)
      : candidates[0] ?? null;
    if (candidate === current) return;
    current = candidate;
    onVideo(candidate);
  };

  const observer = new MutationObserver(inspect);
  const begin = () => {
    if (stopped) return;
    observer.observe(document.documentElement, { childList: true, subtree: true });
    inspect();
  };

  if (document.documentElement) begin();
  else document.addEventListener('DOMContentLoaded', begin, { once: true });

  return () => {
    stopped = true;
    observer.disconnect();
    document.removeEventListener('DOMContentLoaded', begin);
  };
}
