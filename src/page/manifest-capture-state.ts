import type { NetflixManifestSnapshot } from '../netflix/netflix-types';

const publicSnapshot = (snapshot: NetflixManifestSnapshot): NetflixManifestSnapshot => ({
  ...snapshot,
  tracks: snapshot.tracks.map((track) => ({
    ...track,
    downloads: track.downloads.map((download) => ({ ...download, urls: [] })),
  })),
});

const signature = (snapshot: NetflixManifestSnapshot): string => JSON.stringify([
  snapshot.activeTextTrackId,
  snapshot.audioLanguage,
  snapshot.tracks.map((track) => [
    track.trackId,
    track.hydrated,
    track.downloads.map((download) => [download.profile, download.urls]),
  ]),
]);

/**
 * Keeps page-realm manifest state without exposing signed subtitle URLs to the
 * isolated extension world. Netflix often preloads Episode B while Episode A
 * is still the current route; replay() publishes that stored snapshot only
 * after navigation makes Episode B current.
 */
export class ManifestCaptureState {
  private static readonly MAX_EPISODES = 8;
  private readonly manifests = new Map<string, NetflixManifestSnapshot>();
  private readonly seen = new Map<string, string>();

  record(snapshot: NetflixManifestSnapshot): NetflixManifestSnapshot | undefined {
    this.manifests.delete(snapshot.contentId);
    this.manifests.set(snapshot.contentId, snapshot);
    while (this.manifests.size > ManifestCaptureState.MAX_EPISODES) {
      const oldest = this.manifests.keys().next().value as string | undefined;
      if (!oldest) break;
      this.manifests.delete(oldest);
      this.seen.delete(oldest);
    }
    const nextSignature = signature(snapshot);
    if (this.seen.get(snapshot.contentId) === nextSignature) return undefined;
    this.seen.set(snapshot.contentId, nextSignature);
    return publicSnapshot(snapshot);
  }

  replay(contentId: string): NetflixManifestSnapshot | undefined {
    const snapshot = this.manifests.get(contentId);
    return snapshot ? publicSnapshot(snapshot) : undefined;
  }
}
