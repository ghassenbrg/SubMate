import type { PlatformId, SubtitleCue } from '../subtitles/models';
import type { FlixTranslateSettings } from '../settings/schema';

export type { PlatformId };

export interface PlatformCapabilities {
  /** The platform exposes an original-language text subtitle track we can read. */
  supportsOriginalSubtitles: boolean;
  /** The whole episode can be extracted up front instead of cue-by-cue at playback. */
  supportsFullEpisodeExtraction: boolean;
  /** Original and translated lines can be shown together. */
  supportsDualSubtitles: boolean;
  /** Episode changes are observable without a full page reload. */
  supportsEpisodeDetection: boolean;
  /** Advertisement playback can be distinguished from content playback. */
  supportsAdDetection: boolean;
}

/**
 * Outcome of asking an adapter which source track to translate for the current
 * content. Every non-`ready` case maps to a distinct, user-meaningful state so
 * the UI never reports a generic failure for an ordinary situation such as
 * "this episode simply has no captions".
 */
export type SourceSelection =
  /** Not enough information yet; the adapter will notify when that changes. */
  | { kind: 'pending' }
  /** A translatable original text track was found. */
  | { kind: 'ready'; trackId: string; language: string; label?: string; profile?: string }
  /** The platform already offers the user's target language natively. */
  | { kind: 'target-available' }
  /** Only bitmap subtitles exist, which cannot be translated as text. */
  | { kind: 'image-only' }
  /** The content genuinely has no text subtitle track. */
  | { kind: 'none' };

export interface ExtractedSource {
  cues: SubtitleCue[];
  language: string;
  trackId: string;
  label?: string;
  profile?: string;
}

/**
 * Callbacks an adapter uses to push runtime changes into the orchestrator.
 * Adapters never touch translation, caching or rendering directly.
 */
export interface AdapterHost {
  /** The active content changed (SPA navigation, episode switch, new manifest). */
  onContentChanged(contentId: string | undefined): void;
  /** Track availability changed for the *same* content; re-run selection. */
  onSourceAvailabilityChanged(): void;
  /** The active media element was created, replaced or removed. */
  onVideoChanged(video: HTMLVideoElement | null): void;
  /** Advertisement playback started or stopped. */
  onAdStateChanged(adPlaying: boolean): void;
  /** Namespaced debug logging, only emitted when debug mode is on. */
  debug(message: string, detail?: unknown): void;
}

export interface PlatformAdapter {
  readonly id: PlatformId;
  readonly capabilities: PlatformCapabilities;

  /** True when this adapter handles the given location. */
  matches(url: URL): boolean;

  /** Begin observing the page. Must be idempotent-safe against `stop()`. */
  start(host: AdapterHost): void;

  /** Detach every listener, observer and patch this adapter installed. */
  stop(): void;

  /** Stable identifier for the current content, if known. */
  getContentId(): string | undefined;

  /** Decide which original track to translate, given the user's preferences. */
  selectSource(settings: FlixTranslateSettings): SourceSelection;

  /** Retrieve and normalize the cues for a previously selected track. */
  extractSource(selection: Extract<SourceSelection, { kind: 'ready' }>, signal: AbortSignal): Promise<ExtractedSource>;

  /** The media element currently presenting content, if any. */
  getVideo(): HTMLVideoElement | undefined;

  /** True while an advertisement is playing instead of episode content. */
  isAdPlaying(): boolean;

  /**
   * Text the platform's own subtitle layer is currently drawing, when it can be
   * read cheaply. Used only as a synchronization cross-check; optional.
   */
  getNativeSubtitleText?(): string;

  /** Extra fields for the developer diagnostics panel. */
  getDebugInfo?(): Record<string, unknown>;
}
