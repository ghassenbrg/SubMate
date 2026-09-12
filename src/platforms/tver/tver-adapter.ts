import { observeVideoElement } from '../../core/playback/video-observer';
import { sameLanguage } from '../../core/subtitles/language';
import type { FlixTranslateSettings } from '../../settings/schema';
import { isTVerHost, routeEpisodeId } from './tver-detection';
import { isAdvertisementPlaying, pickContentVideo, readAdSignals } from './tver-player';
import { requestTVerSubtitles, startTVerBridge } from './tver-bridge';
import { cuesFromSegments } from './tver-subtitles';
import type {
  AdapterHost,
  ExtractedSource,
  PlatformAdapter,
  PlatformCapabilities,
  SourceSelection,
} from '../types';

/** TVer captions are Japanese; the platform exposes no other source language. */
const TVER_SOURCE_LANGUAGE = 'ja';

/**
 * Version of the TVer subtitle timeline reconstruction.
 *
 * It is part of the track id, so improving extraction retires previously cached
 * tracks automatically: the orchestrator sees a different track for the same
 * episode and re-runs the pipeline instead of restoring stale timings.
 *
 * v2 — removed the stream presentation-clock origin, which had shifted whole
 *      tracks later by the stream's initial PTS.
 */
const TVER_TIMELINE_VERSION = 2;

/**
 * How long to wait for a media manifest to be observed before attempting
 * extraction anyway. Some playback paths never surface a manifest to our
 * observers, and a bounded wait turns that into a real error rather than an
 * indefinite "finding subtitles" state.
 */
const MANIFEST_GRACE_MS = 12_000;

/** Ad state has no reliable event, so it is sampled while a video exists. */
const AD_POLL_MS = 400;

export class TVerAdapter implements PlatformAdapter {
  readonly id = 'tver' as const;

  readonly capabilities: PlatformCapabilities = {
    supportsOriginalSubtitles: true,
    supportsFullEpisodeExtraction: true,
    supportsDualSubtitles: true,
    supportsEpisodeDetection: true,
    supportsAdDetection: true,
  };

  private host: AdapterHost | undefined;
  private video: HTMLVideoElement | undefined;
  private stopBridge: (() => void) | undefined;
  private stopVideo: (() => void) | undefined;
  private adTimer: number | undefined;
  private graceTimer: number | undefined;
  private manifestObserved = false;
  private graceElapsed = false;
  private adPlaying = false;
  private contentId: string | undefined;

  matches(url: URL): boolean {
    return isTVerHost(url);
  }

  start(host: AdapterHost): void {
    this.host = host;
    this.contentId = routeEpisodeId();
    this.stopBridge = startTVerBridge({
      onManifestObserved: (count) => {
        if (this.manifestObserved) return;
        this.manifestObserved = true;
        host.debug('media manifest observed', { count });
        host.onSourceAvailabilityChanged();
      },
      onNavigation: (contentId) => this.handleNavigation(contentId),
    });
    this.stopVideo = observeVideoElement(
      'video',
      (video) => {
        this.video = video ?? undefined;
        host.debug('content video changed', { present: Boolean(video) });
        this.syncAdState();
        this.startTimers();
        host.onVideoChanged(video);
      },
      { pickBest: pickContentVideo },
    );
    this.startTimers();
    host.debug('adapter started', { contentId: this.contentId ?? null });
  }

  stop(): void {
    this.stopBridge?.();
    this.stopVideo?.();
    this.clearTimers();
    this.stopBridge = undefined;
    this.stopVideo = undefined;
    this.video = undefined;
    this.host = undefined;
    this.manifestObserved = false;
    this.graceElapsed = false;
    this.adPlaying = false;
  }

  getContentId(): string | undefined {
    return this.contentId ?? routeEpisodeId();
  }

  selectSource(settings: FlixTranslateSettings): SourceSelection {
    if (!this.getContentId()) return { kind: 'pending' };
    // Translating Japanese into Japanese is pointless; TVer already shows it.
    if (sameLanguage(settings.preferredTargetLanguage, TVER_SOURCE_LANGUAGE)) {
      return { kind: 'target-available' };
    }
    if (!this.video) return { kind: 'pending' };
    if (!this.manifestObserved && !this.graceElapsed) return { kind: 'pending' };
    return {
      kind: 'ready',
      trackId: `tver:${this.getContentId() ?? 'unknown'}:ja:v${TVER_TIMELINE_VERSION}`,
      language: TVER_SOURCE_LANGUAGE,
      profile: 'hls-webvtt',
    };
  }

  async extractSource(
    selection: Extract<SourceSelection, { kind: 'ready' }>,
    signal: AbortSignal,
  ): Promise<ExtractedSource> {
    const payload = await requestTVerSubtitles(TVER_SOURCE_LANGUAGE, signal);
    this.host?.debug('subtitle segments received', {
      segments: payload.segments.length,
      failedSegments: payload.failedSegments,
      language: payload.track.language,
    });
    const cues = cuesFromSegments(payload.segments);
    this.host?.debug('subtitle cues normalized', {
      cues: cues.length,
      // Handy for spotting a whole-track timing shift at a glance.
      firstCueMs: cues[0]?.startMs ?? null,
      lastCueMs: cues.at(-1)?.endMs ?? null,
    });
    return {
      cues,
      language: payload.track.language || TVER_SOURCE_LANGUAGE,
      trackId: selection.trackId,
      ...(payload.track.name ? { label: payload.track.name } : {}),
      profile: 'hls-webvtt',
    };
  }

  getVideo(): HTMLVideoElement | undefined {
    return this.video;
  }

  isAdPlaying(): boolean {
    return this.adPlaying;
  }

  /**
   * Reads the captions TVer's own player is displaying, using the standard
   * HTML5 text-track API rather than a markup selector. Returns an empty string
   * when the viewer has native captions switched off.
   */
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
      episodeId: this.getContentId() ?? null,
      manifestObserved: this.manifestObserved,
      graceElapsed: this.graceElapsed,
      adPlaying: this.adPlaying,
      adSignals: readAdSignals(this.video),
      hasVideo: Boolean(this.video),
    };
  }

  private handleNavigation(contentId?: string): void {
    const next = contentId ?? routeEpisodeId();
    if (next === this.contentId) return;
    this.contentId = next;
    // A new episode invalidates manifest discovery for the previous one.
    this.manifestObserved = false;
    this.graceElapsed = false;
    this.startTimers();
    this.host?.debug('episode navigation', { contentId: next ?? null });
    this.host?.onContentChanged(next);
  }

  private startTimers(): void {
    if (this.adTimer === undefined && this.video) {
      this.adTimer = window.setInterval(() => this.syncAdState(), AD_POLL_MS);
    }
    if (this.graceTimer === undefined && !this.graceElapsed) {
      this.graceTimer = window.setTimeout(() => {
        this.graceTimer = undefined;
        if (this.graceElapsed) return;
        this.graceElapsed = true;
        this.host?.debug('manifest grace period elapsed');
        this.host?.onSourceAvailabilityChanged();
      }, MANIFEST_GRACE_MS);
    }
  }

  private clearTimers(): void {
    if (this.adTimer !== undefined) window.clearInterval(this.adTimer);
    if (this.graceTimer !== undefined) window.clearTimeout(this.graceTimer);
    this.adTimer = undefined;
    this.graceTimer = undefined;
  }

  private syncAdState(): void {
    const next = isAdvertisementPlaying(this.video);
    if (next === this.adPlaying) return;
    this.adPlaying = next;
    this.host?.debug(next ? 'advertisement started' : 'advertisement ended');
    this.host?.onAdStateChanged(next);
  }
}
