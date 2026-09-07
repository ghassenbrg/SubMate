export function observeNetflixPlayer(onPlayer: (video: HTMLVideoElement | null) => void): () => void {
  let current: HTMLVideoElement | null = null;
  const inspect = () => {
    const candidate = document.querySelector<HTMLVideoElement>('#appMountPoint video, video');
    if (candidate === current) return;
    current = candidate;
    onPlayer(candidate);
  };
  const observer = new MutationObserver(inspect);
  const begin = () => {
    observer.observe(document.documentElement, { childList: true, subtree: true });
    inspect();
  };
  if (document.documentElement) begin();
  else document.addEventListener('DOMContentLoaded', begin, { once: true });
  return () => observer.disconnect();
}
