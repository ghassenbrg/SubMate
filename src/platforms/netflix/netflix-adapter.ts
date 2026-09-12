import { startNetflixBridge, requestPageSubtitle } from './netflix-bridge';
import { chooseSourceTrack, chooseTextDownload } from '../../netflix/manifest-parser';
import type { NetflixManifestSnapshot } from '../../netflix/netflix-types';
import { observeVideoElement } from '../../core/playback/video-observer';
import type { FlixTranslateSettings } from '../../settings/schema';
import { FlixTranslateError } from '../../shared-errors';
import { parseSubtitle } from '../../subtitles/parser';
import { visibleNetflixSubtitleText } from './native-captions';
import type {
  AdapterHost,
  ExtractedSource,
  PlatformAdapter,
  PlatformCapabilities,
  SourceSelection,
} from '../types';

const WATCH_PATH = /^\/watch\/(\d+)/;

/** Netflix content id implied by the current route, if any. */
const routeContentId = (): string | undefined => WATCH_PATH.exec(location.pathname)?.[1];

/**
 * Netflix support, expressed through the shared platform contract.
 *
 * All Netflix-specific knowledge — the MAIN-world manifest bridge, track
 * ranking, subtitle profiles and the native timed-text DOM — is confined here.
 */
export class NetflixAdapter implements PlatformAdapter {
  readonly id = 'netflix' as const;

  readonly capabilities: PlatformCapabilities = {
    supportsOriginalSubtitles: true,
    supportsFullEpisodeExtraction: true,
    supportsDualSubtitles: true,
    supportsEpisodeDetection: true,
    // Netflix ads are not distinguished yet; content playback is assumed.
    supportsAdDetection: false,
  };

  private host: AdapterHost | undefined;
  private snapshot: NetflixManifestSnapshot | undefined;
  private video: HTMLVideoElement | undefined;
  private stopBridge: (() => void) | undefined;
  private stopVideo: (() => void) | undefined;

  matches(url: URL): boolean {
    return url.hostname === 'www.netflix.com' || url.hostname.endsWith('.netflix.com');
  }

  start(host: AdapterHost): void {
    this.host = host;
    this.stopBridge = startNetflixBridge({
      onManifest: (snapshot) => this.handleManifest(snapshot),
      onNavigation: (contentId) => this.handleNavigation(contentId),
    });
    this.stopVideo = observeVideoElement('#appMountPoint video, video', (video) => {
      this.video = video ?? undefined;
      host.onVideoChanged(video);
    });
    host.debug('adapter started');
  }

  stop(): void {
    this.stopBridge?.();
    this.stopVideo?.();
    this.stopBridge = undefined;
    this.stopVideo = undefined;
    this.snapshot = undefined;
    this.video = undefined;
    this.host = undefined;
  }

  getContentId(): string | undefined {
    return this.snapshot?.contentId ?? routeContentId();
  }

  selectSource(settings: FlixTranslateSettings): SourceSelection {
    const snapshot = this.snapshot;
    if (!snapshot) return { kind: 'pending' };
    const choice = chooseSourceTrack(
      snapshot,
      settings.preferredTargetLanguage,
      settings.preferredSourceLanguage,
    );
    if (choice.targetAlreadyAvailable) return { kind: 'target-available' };
    if (!choice.source) return choice.imageOnly ? { kind: 'image-only' } : { kind: 'none' };
    const download = chooseTextDownload(choice.source);
    if (!download) return { kind: 'none' };
    return {
      kind: 'ready',
      trackId: choice.source.trackId,
      language: choice.source.language,
      label: choice.source.label,
      profile: download.profile,
    };
  }

  async extractSource(
    selection: Extract<SourceSelection, { kind: 'ready' }>,
    signal: AbortSignal,
  ): Promise<ExtractedSource> {
    const contentId = this.snapshot?.contentId;
    if (!contentId) throw new FlixTranslateError('NETFLIX_MANIFEST_NOT_FOUND', 'No captured Netflix manifest');
    const raw = await requestPageSubtitle(contentId, selection.trackId, selection.profile ?? '', signal);
    const cues = parseSubtitle(raw.text, selection.profile ?? '', raw.contentType);
    return {
      cues,
      language: selection.language,
      trackId: selection.trackId,
      ...(selection.label ? { label: selection.label } : {}),
      ...(selection.profile ? { profile: selection.profile } : {}),
    };
  }

  getVideo(): HTMLVideoElement | undefined {
    return this.video;
  }

  isAdPlaying(): boolean {
    return false;
  }

  getNativeSubtitleText(): string {
    return visibleNetflixSubtitleText();
  }

  getDebugInfo(): Record<string, unknown> {
    return {
      manifestContentId: this.snapshot?.contentId ?? null,
      manifestTracks: this.snapshot?.tracks.length ?? 0,
      activeTextTrackId: this.snapshot?.activeTextTrackId ?? null,
      audioLanguage: this.snapshot?.audioLanguage ?? null,
    };
  }

  private handleNavigation(contentId?: string): void {
    if (contentId && contentId === this.snapshot?.contentId) return;
    this.snapshot = undefined;
    this.host?.onContentChanged(contentId);
  }

  private handleManifest(snapshot: NetflixManifestSnapshot): void {
    // Netflix emits manifests for hover previews and preloaded next episodes.
    // Only the manifest matching the current route describes what is playing.
    const pathId = routeContentId();
    if (!pathId || pathId !== snapshot.contentId) return;
    const isNewContent = snapshot.contentId !== this.snapshot?.contentId;
    this.snapshot = snapshot;
    this.host?.debug('manifest captured', { contentId: snapshot.contentId, tracks: snapshot.tracks.length });
    if (isNewContent) this.host?.onContentChanged(snapshot.contentId);
    else this.host?.onSourceAvailabilityChanged();
  }
}
