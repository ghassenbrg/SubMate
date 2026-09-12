import { observeVideoElement } from '../../core/playback/video-observer';
import type { SubMateSettings } from '../../settings/schema';
import { SubMateError } from '../../shared-errors';
import { parseSubtitle } from '../../subtitles/parser';
import { isPrimeVideoUrl, routeContentId } from './prime-detection';
import { chooseSubtitleTrack, type PrimePlaybackSnapshot } from './prime-manifest';
import { requestPrimeSubtitle, startPrimeBridge } from './prime-bridge';
import { isAdvertisementPlaying, pickContentVideo, readAdSignals } from './prime-player';
import type {
  AdapterHost,
  ExtractedSource,
  PlatformAdapter,
  PlatformCapabilities,
  SourceSelection,
} from '../types';

/** Advertisement state has no reliable event, so it is sampled. */
const AD_POLL_MS = 400;

/**
 * Amazon Prime Video support.
 *
 * Subtitles are sidecar timed-text documents that Amazon's playback payload
 * points the player at. This adapter reads only what that authorized payload
 * already exposed; it performs no licence, key or protected-media request.
 */
export class PrimeVideoAdapter implements PlatformAdapter {
  readonly id = 'prime' as const;

  readonly capabilities: PlatformCapabilities = {
    supportsOriginalSubtitles: true,
    supportsFullEpisodeExtraction: true,
    supportsDualSubtitles: true,
    supportsEpisodeDetection: true,
    supportsAdDetection: true,
  };

  private host: AdapterHost | undefined;
  private snapshot: PrimePlaybackSnapshot | undefined;
  private video: HTMLVideoElement | undefined;
  private stopBridge: (() => void) | undefined;
  private stopVideo: (() => void) | undefined;
  private adTimer: number | undefined;
  private adPlaying = false;

  matches(url: URL): boolean {
    return isPrimeVideoUrl(url);
  }

  start(host: AdapterHost): void {
    this.host = host;
    this.stopBridge = startPrimeBridge({
      onPlayback: (snapshot) => this.handlePlayback(snapshot),
      onNavigation: (contentId) => this.handleNavigation(contentId),
      onDiagnostic: (reason, detail) => host.debug(`discovery: ${reason}`, detail),
    });
    this.stopVideo = observeVideoElement(
      'video',
      (video) => {
        this.video = video ?? undefined;
        host.debug('content video changed', { present: Boolean(video) });
        this.syncAdState();
        this.startAdPolling();
        host.onVideoChanged(video);
      },
      { pickBest: pickContentVideo },
    );
    this.startAdPolling();
    host.debug('adapter started', { contentId: routeContentId() ?? null });
  }

  stop(): void {
    this.stopBridge?.();
    this.stopVideo?.();
    if (this.adTimer !== undefined) window.clearInterval(this.adTimer);
    this.adTimer = undefined;
    this.stopBridge = undefined;
    this.stopVideo = undefined;
    this.snapshot = undefined;
    this.video = undefined;
    this.host = undefined;
    this.adPlaying = false;
  }

  getContentId(): string | undefined {
    return this.snapshot?.contentId ?? routeContentId();
  }

  selectSource(settings: SubMateSettings): SourceSelection {
    const snapshot = this.snapshot;
    if (!snapshot) return { kind: 'pending' };
    const choice = chooseSubtitleTrack(
      snapshot,
      settings.preferredTargetLanguage,
      settings.preferredSourceLanguage,
    );
    if (choice.targetAlreadyAvailable) return { kind: 'target-available' };
    if (!choice.source) return { kind: 'none' };
    return {
      kind: 'ready',
      // The track is addressed by language, never by its signed URL, so the id
      // stays stable while Amazon rotates addresses between sessions.
      trackId: `prime:${snapshot.contentId}:${choice.source.language}${choice.source.forced ? ':forced' : ''}`,
      language: choice.source.language,
      ...(choice.source.label ? { label: choice.source.label } : {}),
      ...(choice.source.format ? { profile: choice.source.format } : {}),
    };
  }

  async extractSource(
    selection: Extract<SourceSelection, { kind: 'ready' }>,
    signal: AbortSignal,
  ): Promise<ExtractedSource> {
    const snapshot = this.snapshot;
    if (!snapshot) throw new SubMateError('NO_MANIFEST', 'No captured Prime Video playback payload');
    const forced = selection.trackId.endsWith(':forced');
    const raw = await requestPrimeSubtitle(snapshot.contentId, selection.language, forced, signal);
    const cues = parseSubtitle(raw.text, selection.profile ?? '', raw.contentType);
    this.host?.debug('subtitle cues normalized', {
      cues: cues.length,
      firstCueMs: cues[0]?.startMs ?? null,
      language: selection.language,
    });
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
    return this.adPlaying;
  }

  /** Reads Prime's own captions through the standard text-track API. */
  getNativeSubtitleText(): string {
    const video = this.video;
    if (!video) return '';
    try {
      const lines: string[] = [];
      for (const track of Array.from(video.textTracks ?? [])) {
        if (track.mode !== 'showing') continue;
        if (track.kind !== 'subtitles' && track.kind !== 'captions') continue;
        for (const cue of Array.from(track.activeCues ?? [])) {
          const text = (cue as VTTCue).text;
          if (typeof text === 'string' && text.trim()) lines.push(text.trim());
        }
      }
      return [...new Set(lines)].join('\n');
    } catch {
      return '';
    }
  }

  getDebugInfo(): Record<string, unknown> {
    return {
      titleId: this.getContentId() ?? null,
      subtitleTracks: this.snapshot?.subtitles.length ?? 0,
      audioLanguage: this.snapshot?.audioLanguage ?? null,
      adPlaying: this.adPlaying,
      adSignals: readAdSignals(this.video),
      hasVideo: Boolean(this.video),
    };
  }

  private handlePlayback(snapshot: PrimePlaybackSnapshot): void {
    const route = routeContentId();
    // Prime resolves playback for recommendations and next-episode preloads.
    if (route && snapshot.contentId !== route) return;
    const isNewContent = snapshot.contentId !== this.snapshot?.contentId;
    this.snapshot = snapshot;
    this.host?.debug('playback payload captured', {
      contentId: snapshot.contentId,
      subtitles: snapshot.subtitles.length,
    });
    if (isNewContent) this.host?.onContentChanged(snapshot.contentId);
    else this.host?.onSourceAvailabilityChanged();
  }

  private handleNavigation(contentId?: string): void {
    const next = contentId ?? routeContentId();
    if (next && next === this.snapshot?.contentId) return;
    this.snapshot = undefined;
    this.host?.debug('title navigation', { contentId: next ?? null });
    this.host?.onContentChanged(next);
  }

  private startAdPolling(): void {
    if (this.adTimer !== undefined || !this.video) return;
    this.adTimer = window.setInterval(() => this.syncAdState(), AD_POLL_MS);
  }

  private syncAdState(): void {
    const next = isAdvertisementPlaying(this.video);
    if (next === this.adPlaying) return;
    this.adPlaying = next;
    this.host?.debug(next ? 'advertisement started' : 'advertisement ended');
    this.host?.onAdStateChanged(next);
  }
}
