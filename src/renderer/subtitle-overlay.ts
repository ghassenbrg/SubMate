import type { SubMateSettings } from '../settings/schema';
import { subtitleAppearanceVariables } from '../settings/appearance';
import { isRtlLocale, t, uiLocale } from '../i18n';
import type { SubtitleTrack, TranslationStatus } from '../subtitles/models';
import { CueIndex } from './cue-index';
import { createDisplayModeTiles } from '../ui/shared/display-mode';

/**
 * Platform-supplied playback facts the renderer needs but must not discover
 * itself. Keeping these behind an injected object is what allows the overlay to
 * stay free of any Netflix- or TVer-specific DOM knowledge.
 */
export interface OverlayPlaybackContext {
  /** True while an advertisement is playing instead of episode content. */
  isAdPlaying(): boolean;
  /** Text the platform's own subtitle layer is drawing right now, if readable. */
  getNativeSubtitleText?(): string;
}

export interface OverlayActions {
  onActivate(): void;
  onRetry(): void;
  onDisplayMode(mode: SubMateSettings['displayMode']): void;
  onToggleEnabled(): void;
  onOpenSettings(): void;
}

const STATUS_LABELS: Record<TranslationStatus['state'], string> = {
  idle: t('overlayWaiting'),
  disabled: t('off'),
  discovering: t('overlayFinding'),
  downloading_source: t('statusDownloadingSource'),
  parsing_source: t('overlayReading'),
  checking_cache: t('overlayChecking'),
  target_available: t('overlayNativeAvailable'),
  needs_user_activation: t('overlayReadyToTranslate'),
  downloading_model: t('statusDownloadingModel'),
  translating: t('overlayPreparing'),
  validating: t('statusValidating'),
  ready: t('statusReady'),
  unsupported_image_track: t('overlayImageUnsupported'),
  no_text_track: t('overlayNoText'),
  failed: t('overlayFailed'),
};

/**
 * The SubMate glyph: the gradient play triangle over two subtitle bars, the
 * same geometry as public/icons/icon.svg without its tile.
 *
 * Drawn inline rather than loaded from icons/. Referencing a packaged image
 * from a page would require a web_accessible_resources entry, which makes the
 * extension trivially detectable by any site the user visits.
 *
 * Bar colours come from CSS so the mark stays legible on a light or dark
 * button; the gradient id must be unique within the shadow root.
 */
const markSvg = (gradientId: string): string =>
  `<svg class="mark" viewBox="14 13 72 74" aria-hidden="true"><defs><linearGradient id="${gradientId}" x1="33" y1="16" x2="70" y2="58" gradientUnits="userSpaceOnUse">`
  + '<stop offset="0" stop-color="#38f7ee"/><stop offset=".5" stop-color="#19b9fb"/><stop offset="1" stop-color="#1f66f5"/></linearGradient></defs>'
  + `<path d="M37.5 21.5v31.8l29-15.9z" fill="url(#${gradientId})" stroke="url(#${gradientId})" stroke-width="10" stroke-linejoin="round"/>`
  + '<rect class="mark-bar" x="19" y="63.8" width="62.6" height="8.4" rx="4.2"/>'
  + '<rect class="mark-bar-soft" x="30.1" y="77.5" width="40.4" height="6.7" rx="3.35"/></svg>';

/**
 * Colours for the in-player controls. The shadow root cannot inherit the
 * extension pages' theme tokens, so the values that matter here are repeated,
 * in the same palette, for light and dark. `data-theme` on the host carries
 * the user's choice; without it the controls follow the OS.
 */
const DARK_TOKENS = '--sm-surface:#111826;--sm-raised:#18212f;--sm-raised-hover:#212c3d;--sm-band:#121a27;--sm-sunken:#0c121d;'
  + '--sm-text:#f2f6fb;--sm-muted:#9aa8bf;--sm-status:#c6d0df;--sm-border:rgba(170,195,235,.12);--sm-border-hover:rgba(170,195,235,.3);'
  + '--sm-accent:#2a6ff2;--sm-accent-text:#6aaeff;--sm-accent-soft:rgba(42,111,242,.2);--sm-focus:#6aaeff;'
  + '--sm-indicator:rgba(13,19,31,.94);--sm-indicator-hover:rgba(24,33,47,.98);--sm-indicator-border:rgba(242,246,251,.18);'
  + '--sm-bar:#f2f6fb;--sm-bar-soft:#6f83a4;--sm-shadow:0 28px 64px rgba(0,0,0,.58);--sm-dot:#6f83a4;--sm-ok:#4fd8a4;--sm-warn:#f2c76e;--sm-danger:#ff6b7d';
const LIGHT_TOKENS = '--sm-surface:#ffffff;--sm-raised:#eef2f8;--sm-raised-hover:#e3e9f2;--sm-band:#f2f5fa;--sm-sunken:#f5f7fb;'
  + '--sm-text:#0d131f;--sm-muted:#56657d;--sm-status:#2b3548;--sm-border:rgba(13,19,31,.1);--sm-border-hover:rgba(13,19,31,.24);'
  + '--sm-accent:#1a62e8;--sm-accent-text:#1a62e8;--sm-accent-soft:rgba(31,108,251,.12);--sm-focus:#1a62e8;'
  + '--sm-indicator:rgba(255,255,255,.95);--sm-indicator-hover:#ffffff;--sm-indicator-border:rgba(13,19,31,.12);'
  + '--sm-bar:#0d131f;--sm-bar-soft:#6f83a4;--sm-shadow:0 24px 56px rgba(0,0,0,.35);--sm-dot:#8391a8;--sm-ok:#0f7f57;--sm-warn:#8a5b06;--sm-danger:#c3202f';

/**
 * How long the pointer may rest before the control hides, in step with the
 * streaming players' own controls (Netflix, Prime Video and TVer all hide
 * theirs after roughly three seconds).
 */
const INDICATOR_IDLE_MS = 3_000;
const IDLE_WAKE_EVENTS = ['pointermove', 'pointerdown', 'touchstart', 'wheel'] as const;

export class SubtitleOverlay {
  readonly host: HTMLDivElement;
  private readonly shadow: ShadowRoot;
  private readonly subtitle: HTMLDivElement;
  private readonly sourceLine: HTMLDivElement;
  private readonly translationLine: HTMLDivElement;
  private readonly indicator: HTMLButtonElement;
  private readonly indicatorState: HTMLSpanElement;
  private readonly panel: HTMLDivElement;
  private readonly statusText: HTMLDivElement;
  private readonly progress: HTMLProgressElement;
  private readonly actionRow: HTMLDivElement;
  private track: SubtitleTrack | undefined;
  private cueIndex: CueIndex | undefined;
  private context: OverlayPlaybackContext | undefined;
  private video: HTMLVideoElement | undefined;
  private frame: number | undefined;
  private settings: SubMateSettings;
  private status: TranslationStatus = { state: 'idle' };
  private sourceLanguage: string | undefined;
  private targetLanguage: string | undefined;
  private lastNativeText = '';
  private lastNativeSampleAt = Number.NEGATIVE_INFINITY;
  private lastRenderSignature = '';
  private idleTimer: number | undefined;
  private pointerOnIndicator = false;
  private videoResize: ResizeObserver | undefined;
  private lastRectSyncAt = Number.NEGATIVE_INFINITY;
  private lastRectSignature = '';
  private readonly onViewportChange = () => this.positionToVideo();
  private readonly onTimeUpdate = () => {
    this.renderFrame();
    if (this.video && !this.video.paused && !this.frame) this.startLoop();
  };
  private readonly onFullscreen = () => this.mount();
  /** Any sign of a viewer brings the control back, as it does the player's. */
  private readonly onPointerActivity = () => {
    if (this.video) this.wakeIndicator();
  };
  /** Players hide their controls as soon as the pointer leaves the window. */
  private readonly onPointerLeavePage = () => {
    this.pointerOnIndicator = false;
    this.idleIndicator();
  };
  private readonly onKeyDown = (event: KeyboardEvent) => {
    if (event.key === 'Escape' && this.panel.classList.contains('open')) {
      this.setPanelOpen(false);
      this.indicator.focus();
    }
    if (this.video) this.wakeIndicator();
  };

  constructor(settings: SubMateSettings, private readonly actions: OverlayActions) {
    document.getElementById('submate-root')?.remove();
    this.settings = settings;
    this.host = document.createElement('div');
    this.host.id = 'submate-root';
    this.host.setAttribute('data-submate', 'root');
    this.host.dir = isRtlLocale() ? 'rtl' : 'ltr';
    this.shadow = this.host.attachShadow({ mode: 'closed' });
    this.shadow.innerHTML = `
      <style>
        :host{all:initial;position:fixed;inset:0;z-index:2147483000;pointer-events:none;font-family:Inter,Arial,sans-serif;color:#fff}
        .subtitle{position:absolute;left:6%;right:6%;bottom:var(--ft-bottom,13%);display:none;text-align:center;pointer-events:none;line-height:var(--ft-line-height,1.22);opacity:var(--ft-opacity,1)}
        .cue{display:table;margin:.12em auto;padding:var(--ft-cue-padding,.1em .36em);border-radius:var(--ft-radius,.18em);background:var(--ft-background,rgba(0,0,0,.68));color:var(--ft-color,#fff);text-shadow:var(--ft-text-shadow,0 2px 3px #000);max-width:min(86%,62rem);white-space:pre-wrap;overflow-wrap:anywhere;unicode-bidi:plaintext}
        .source{font-size:calc(clamp(18px,2.1vw,32px)*var(--ft-scale,1));font-weight:500;opacity:.88}
        .translation{font-size:calc(clamp(20px,2.4vw,38px)*var(--ft-scale,1));font-weight:var(--ft-weight,650)}
        :host{${DARK_TOKENS}}
        @media (prefers-color-scheme:light){:host(:not([data-theme="dark"])){${LIGHT_TOKENS}}}
        :host([data-theme="light"]){${LIGHT_TOKENS}}
        .indicator{position:absolute;inset-inline-end:22px;bottom:20px;display:grid;place-items:center;box-sizing:border-box;width:38px;height:38px;padding:0;pointer-events:auto;border:1px solid var(--sm-indicator-border);border-radius:10px;background:var(--sm-indicator);color:var(--sm-text);cursor:pointer;box-shadow:0 6px 18px rgba(0,0,0,.38);opacity:1;transition:opacity .25s ease,background .16s ease,border-color .16s ease}
        .indicator:hover,.indicator[aria-expanded="true"]{background:var(--sm-indicator-hover);border-color:var(--sm-accent)}.mark{display:block;width:22px;height:22px}.mark-bar{fill:var(--sm-bar)}.mark-bar-soft{fill:var(--sm-bar-soft)}
        .panel-mark .mark{width:20px;height:20px}.panel-mark .mark-bar{fill:#f2f6fb}.panel-mark .mark-bar-soft{fill:#6f83a4}
        .indicator-state{position:absolute;inset-inline-end:-3px;top:-3px;display:grid;place-items:center;min-width:12px;height:12px;padding:0 1px;border-radius:999px;background:var(--sm-ok);color:#fff;font:900 8px/1 Arial,sans-serif;box-shadow:0 0 0 2px var(--sm-surface)}.indicator-state:empty{display:none}.indicator[data-state="failed"] .indicator-state{background:var(--sm-danger)}
        /* Hidden along with the player's own controls once the viewer stops
           moving the pointer, and back the moment they do. */
        .indicator.idle:not(:focus-visible){opacity:0;pointer-events:none}.indicator:focus-visible,.panel button:focus-visible{outline:2px solid var(--sm-focus);outline-offset:2px}
        .panel{position:absolute;inset-inline-end:22px;bottom:68px;width:min(286px,calc(100vw - 28px));max-height:min(74vh,570px);overflow:auto;overscroll-behavior:contain;box-sizing:border-box;display:none;pointer-events:auto;border:1px solid var(--sm-border);border-radius:18px;background:var(--sm-surface);color:var(--sm-text);padding:0;box-shadow:var(--sm-shadow);font:13px/1.4 Inter,Arial,sans-serif}
        .panel.open{display:block}.panel-head{display:grid;grid-template-columns:30px minmax(0,1fr);gap:10px;align-items:center;padding:13px 14px 12px}.panel-mark{display:grid;place-items:center;width:30px;height:30px;border-radius:8px;background:radial-gradient(circle at 96% 4%,rgba(29,59,130,.75),transparent 78%),linear-gradient(160deg,#16202f,#0a0d15)}.title{font-weight:780;font-size:14px;letter-spacing:-.015em}.pair{color:var(--sm-muted);margin-top:1px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
        .status-card{padding:0 14px 13px}.status{display:flex;align-items:center;gap:8px;color:var(--sm-status);font-size:12px;font-weight:650;line-height:1.4}.status::before{content:"";width:7px;height:7px;flex:0 0 auto;border-radius:999px;background:var(--sm-dot)}.panel[data-state="translating"] .status::before,.panel[data-state="downloading_model"] .status::before{background:var(--sm-warn)}.panel[data-state="ready"] .status::before{background:var(--sm-ok)}.panel[data-state="failed"] .status::before{background:var(--sm-danger)}.progress{width:100%;height:4px;margin-top:9px;accent-color:var(--sm-accent)}.actions{display:flex;flex-wrap:wrap;gap:7px;margin-top:10px}.actions button{flex:1 1 auto}
        .panel button{border:1px solid var(--sm-border);border-radius:8px;background:var(--sm-raised);color:var(--sm-text);padding:9px;cursor:pointer;font:inherit;font-size:12px;font-weight:650;transition:border-color .15s ease,background .15s ease,color .15s ease}.panel button:hover{background:var(--sm-raised-hover);border-color:var(--sm-border-hover)}.panel button.primary{border-color:var(--sm-accent);background:var(--sm-accent);color:#fff;font-weight:750}.panel button.primary:hover{filter:brightness(1.08)}
        /* Same labelled band as the popup and options page, so the three
           surfaces read as one product rather than three control sets. */
        .group-band{display:flex;align-items:center;justify-content:center;gap:7px;padding:7px 14px;border-block:1px solid var(--sm-border);background:var(--sm-band);color:var(--sm-muted);font-size:12px;font-weight:750}.band-icon{width:14px;height:14px;opacity:.8}
        .group-body{padding:11px 14px 13px}
        .mode-tiles{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:7px}
        .panel button.mode-tile{display:grid;gap:5px;justify-items:center;padding:0;border:0;border-radius:0;background:transparent;color:var(--sm-muted)}
        .mode-tile-frame{display:grid;place-items:center;width:100%;height:42px;box-sizing:border-box;border:1.5px solid var(--sm-border);border-radius:11px;background:var(--sm-sunken);transition:border-color .15s ease,background .15s ease}
        .mode-tile-art{width:40px;height:25px}.mode-tile-label{font-size:11px;font-weight:650;line-height:1.2}
        .panel button.mode-tile:hover{background:transparent;border-color:transparent;color:var(--sm-text)}.mode-tile:hover .mode-tile-frame{border-color:var(--sm-border-hover);background:var(--sm-sunken)}
        .panel button.mode-tile[aria-pressed="true"]{background:transparent;color:var(--sm-accent-text)}.mode-tile[aria-pressed="true"] .mode-tile-frame{border-color:var(--sm-accent);background:var(--sm-accent-soft)}
        .mode-tile:focus-visible{outline:none}.mode-tile:focus-visible .mode-tile-frame{outline:2px solid var(--sm-focus);outline-offset:2px}
        .panel-actions{padding:12px 14px}.panel-actions button{width:100%}
        .panel button.link-row{display:block;width:100%;padding:12px;border:0;border-top:1px solid var(--sm-border);border-radius:0;background:transparent;color:var(--sm-accent-text);font:inherit;font-size:13px;font-weight:750;text-align:center;cursor:pointer}
        .panel button.link-row:hover{background:var(--sm-accent-soft);border-color:var(--sm-border);color:var(--sm-accent-text)}
        @media (max-width:700px){.indicator{inset-inline-end:12px;bottom:12px}.panel{inset-inline-end:12px;bottom:60px}.cue{max-width:94%}.translation{font-size:calc(clamp(18px,5vw,30px)*var(--ft-scale,1))}.source{font-size:calc(clamp(16px,4.3vw,25px)*var(--ft-scale,1))}}
        @media (prefers-reduced-motion:no-preference){.panel{animation:ft-in .12s ease-out}@keyframes ft-in{from{opacity:0;transform:translateY(4px)}}}
      </style>
      <div class="subtitle" aria-live="off"><div class="cue source" dir="auto"></div><div class="cue translation" dir="auto"></div></div>
      <button class="indicator" type="button" aria-label="${t('openQuickControls')}" aria-controls="submate-quick-controls" aria-expanded="false">${markSvg('submate-mark-indicator')}<span class="indicator-state" aria-hidden="true"></span></button>
      <section class="panel" id="submate-quick-controls" aria-label="${t('quickControls')}">
        <div class="panel-head"><div class="panel-mark" aria-hidden="true">${markSvg('submate-mark-panel')}</div><div><div class="title">SubMate</div><div class="pair" dir="auto"></div></div></div>
        <div class="status-card"><div class="status" role="status" aria-live="polite"></div><progress class="progress" max="1"></progress><div class="actions"></div></div>
        <div class="group-band"><svg class="band-icon" viewBox="0 0 24 24" fill="none" aria-hidden="true"><path d="M4 5h16a1 1 0 0 1 1 1v12a1 1 0 0 1-1 1H4a1 1 0 0 1-1-1V6a1 1 0 0 1 1-1Zm3 5h3m3 0h4M7 14h4m3 0h3" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/></svg><span>${t('subtitleDisplay')}</span></div>
        <div class="group-body"></div>
        <div class="panel-actions"><button type="button" data-toggle>${t('turnOff')}</button></div>
        <button type="button" class="link-row" data-settings>${t('openSettings')}</button>
      </section>`;
    // The same picture tiles the popup and options page use, so the mode a
    // viewer picks in-player looks identical to the one in the extension UI.
    this.shadow.querySelector('.group-body')?.append(createDisplayModeTiles(settings.displayMode, (mode) => {
      this.updateModeSelection(mode);
      this.actions.onDisplayMode(mode);
    }));
    this.subtitle = this.shadow.querySelector('.subtitle') as HTMLDivElement;
    this.sourceLine = this.shadow.querySelector('.source') as HTMLDivElement;
    this.translationLine = this.shadow.querySelector('.translation') as HTMLDivElement;
    this.indicator = this.shadow.querySelector('.indicator') as HTMLButtonElement;
    this.indicatorState = this.shadow.querySelector('.indicator-state') as HTMLSpanElement;
    this.panel = this.shadow.querySelector('.panel') as HTMLDivElement;
    this.statusText = this.shadow.querySelector('.status') as HTMLDivElement;
    this.progress = this.shadow.querySelector('.progress') as HTMLProgressElement;
    this.actionRow = this.shadow.querySelector('.actions') as HTMLDivElement;
    this.indicator.addEventListener('click', () => this.setPanelOpen(!this.panel.classList.contains('open')));
    // Holding the pointer still over the control produces no further pointermove
    // events, so without these the idle timer would hide it from under the
    // cursor the user is aiming with.
    this.indicator.addEventListener('pointerenter', () => {
      this.pointerOnIndicator = true;
      this.wakeIndicator();
    });
    this.indicator.addEventListener('pointerleave', () => {
      this.pointerOnIndicator = false;
      this.scheduleIdleIndicator();
    });
    this.shadow.querySelector<HTMLButtonElement>('[data-toggle]')?.addEventListener('click', () => this.actions.onToggleEnabled());
    this.shadow.querySelector<HTMLButtonElement>('[data-settings]')?.addEventListener('click', () => this.actions.onOpenSettings());
    document.addEventListener('fullscreenchange', this.onFullscreen);
    // The overlay tracks the media element's box, so anything that can move or
    // resize that box has to re-run positioning. Scroll is captured because the
    // player often lives inside its own scrolling container.
    addEventListener('resize', this.onViewportChange, { passive: true });
    addEventListener('scroll', this.onViewportChange, { capture: true, passive: true });
    for (const event of IDLE_WAKE_EVENTS) document.addEventListener(event, this.onPointerActivity, { passive: true });
    document.documentElement.addEventListener('mouseleave', this.onPointerLeavePage);
    document.addEventListener('keydown', this.onKeyDown);
    this.mount();
    this.applySettings(settings);
  }

  setPlayer(video: HTMLVideoElement | null): void {
    if (this.video === video) return;
    if (this.video) for (const event of ['timeupdate', 'seeked', 'ratechange', 'play', 'pause']) this.video.removeEventListener(event, this.onTimeUpdate);
    this.video = video ?? undefined;
    this.lastNativeSampleAt = Number.NEGATIVE_INFINITY;
    this.lastRenderSignature = '';
    if (this.video) for (const event of ['timeupdate', 'seeked', 'ratechange', 'play', 'pause']) this.video.addEventListener(event, this.onTimeUpdate);
    this.videoResize?.disconnect();
    this.videoResize = undefined;
    if (this.video && typeof ResizeObserver !== 'undefined') {
      this.videoResize = new ResizeObserver(() => this.positionToVideo());
      this.videoResize.observe(this.video);
    }
    this.mount();
    this.startLoop();
    this.updateIndicatorVisibility();
  }

  setTrack(track?: SubtitleTrack): void {
    this.track = track;
    this.cueIndex = track ? new CueIndex(track.cues) : undefined;
    this.lastNativeSampleAt = Number.NEGATIVE_INFINITY;
    this.lastRenderSignature = '';
    this.host.dataset.trackCueCount = String(track?.cues.length ?? 0);
    this.renderFrame();
  }

  /** Supplies the active platform's ad state and native-caption reader. */
  setPlaybackContext(context?: OverlayPlaybackContext): void {
    this.context = context;
    this.lastNativeSampleAt = Number.NEGATIVE_INFINITY;
    this.lastNativeText = '';
    this.lastRenderSignature = '';
    this.renderFrame();
  }

  setLanguages(source?: string, target?: string): void {
    this.sourceLanguage = source;
    this.targetLanguage = target;
    const pair = this.shadow.querySelector('.pair');
    if (pair) pair.textContent = source && target ? `${displayLanguage(source)} → ${displayLanguage(target)}` : '';
  }

  applySettings(settings: SubMateSettings): void {
    this.settings = settings;
    this.host.style.setProperty('--ft-scale', String(settings.translatedFontScale));
    this.host.style.setProperty('--ft-bottom', `${Math.round(settings.verticalPosition * 100)}%`);
    for (const [property, value] of Object.entries(subtitleAppearanceVariables(settings))) {
      this.host.style.setProperty(property, value);
    }
    this.updateModeSelection(settings.displayMode);
    if (settings.theme === 'system') delete this.host.dataset.theme;
    else this.host.dataset.theme = settings.theme;
    this.host.style.display = settings.enabled ? '' : 'none';
    const toggle = this.shadow.querySelector<HTMLButtonElement>('[data-toggle]');
    if (toggle) toggle.textContent = settings.enabled ? t('turnOff') : t('turnOn');
    this.updateIndicatorVisibility();
    this.renderFrame();
  }

  setStatus(status: TranslationStatus): void {
    const stateChanged = status.state !== this.status.state;
    this.status = status;
    this.host.dataset.status = status.state;
    this.statusText.textContent = status.message ?? STATUS_LABELS[status.state];
    this.indicator.dataset.state = status.state;
    this.panel.dataset.state = status.state;
    this.indicatorState.textContent = status.state === 'ready' ? '✓' : status.state === 'failed' ? '!' : '';
    this.updateIndicatorVisibility();
    const hasProgress = status.progress !== undefined && ['translating', 'downloading_model'].includes(status.state);
    this.progress.hidden = !hasProgress;
    if (hasProgress) this.progress.value = status.progress ?? 0;
    this.actionRow.replaceChildren();
    if (status.state === 'needs_user_activation') this.addAction(t('startTranslation'), 'primary', this.actions.onActivate);
    if (status.state === 'failed') this.addAction(t('retry'), 'primary', this.actions.onRetry);
    if (['needs_user_activation', 'failed', 'unsupported_image_track', 'no_text_track'].includes(status.state)) this.setPanelOpen(true);
    if (status.state === 'ready') this.setPanelOpen(false);
    // Surface a change of state briefly, but not every progress tick, or the
    // control would never hide during a long translation.
    if (stateChanged && this.video) this.wakeIndicator();
  }

  destroy(): void {
    if (this.frame) cancelAnimationFrame(this.frame);
    this.clearIdleTimer();
    document.removeEventListener('fullscreenchange', this.onFullscreen);
    removeEventListener('resize', this.onViewportChange);
    removeEventListener('scroll', this.onViewportChange, { capture: true });
    this.videoResize?.disconnect();
    this.videoResize = undefined;
    for (const event of IDLE_WAKE_EVENTS) document.removeEventListener(event, this.onPointerActivity);
    document.documentElement.removeEventListener('mouseleave', this.onPointerLeavePage);
    document.removeEventListener('keydown', this.onKeyDown);
    this.setPlayer(null);
    this.host.remove();
  }

  /** Read-only diagnostics used by synthetic integration tests and debug tooling. */
  getRenderedText(): { source: string; translation: string; visible: boolean } {
    return {
      source: this.sourceLine.textContent ?? '',
      translation: this.translationLine.textContent ?? '',
      visible: this.subtitle.style.display === 'block',
    };
  }

  private addAction(label: string, className: string, callback: () => void): void {
    const button = document.createElement('button');
    button.type = 'button';
    button.className = className;
    button.textContent = label;
    button.addEventListener('click', callback);
    this.actionRow.append(button);
  }

  private setPanelOpen(open: boolean): void {
    this.panel.classList.toggle('open', open);
    this.indicator.setAttribute('aria-expanded', String(open));
    if (open) this.wakeIndicator();
    else this.scheduleIdleIndicator();
  }

  private updateModeSelection(mode: SubMateSettings['displayMode']): void {
    this.shadow.querySelectorAll<HTMLButtonElement>('[data-mode]').forEach((button) => {
      button.setAttribute('aria-pressed', String(button.dataset.mode === mode));
    });
  }

  private updateIndicatorVisibility(): void {
    const actionable = ['needs_user_activation', 'failed', 'unsupported_image_track', 'no_text_track'].includes(this.status.state);
    const visible = Boolean(this.video && (this.settings.showPlayerStatus || actionable));
    const wasVisible = this.indicator.style.display !== 'none';
    this.indicator.style.display = visible ? '' : 'none';
    if (!visible) this.clearIdleTimer();
    else if (!wasVisible) this.wakeIndicator();
  }

  /** Shows the control and restarts the countdown to hiding it again. */
  private wakeIndicator(): void {
    this.indicator.classList.remove('idle');
    this.scheduleIdleIndicator();
  }

  private scheduleIdleIndicator(): void {
    this.clearIdleTimer();
    if (!this.canIdle()) return;
    this.idleTimer = window.setTimeout(() => {
      this.idleTimer = undefined;
      this.idleIndicator();
    }, INDICATOR_IDLE_MS);
  }

  private idleIndicator(): void {
    this.clearIdleTimer();
    if (this.canIdle()) this.indicator.classList.add('idle');
  }

  /** Never hide an open panel's anchor, or a control under the cursor. */
  private canIdle(): boolean {
    return Boolean(this.video) && !this.panel.classList.contains('open') && !this.pointerOnIndicator;
  }

  private clearIdleTimer(): void {
    if (this.idleTimer !== undefined) window.clearTimeout(this.idleTimer);
    this.idleTimer = undefined;
  }

  private mount(): void {
    const fullscreen = document.fullscreenElement;
    if (fullscreen) {
      fullscreen.append(this.host);
      Object.assign(this.host.style, { position: 'absolute', inset: '0', left: '', top: '', width: '', height: '' });
      this.lastRectSignature = 'fullscreen';
      return;
    }
    document.documentElement.append(this.host);
    this.host.style.position = 'fixed';
    this.positionToVideo();
  }

  /**
   * Anchors the overlay to the media element's box rather than the viewport.
   *
   * A player that fills the window (Netflix) makes the two equivalent, but an
   * embedded player on a normal page (TVer windowed) does not: cues positioned
   * against the viewport drift off the video entirely. Falling back to the
   * viewport keeps behaviour unchanged whenever a trustworthy box is
   * unavailable — during layout transitions, or in environments with no real
   * layout at all.
   */
  private positionToVideo(): void {
    if (document.fullscreenElement) return;
    const rect = this.video?.getBoundingClientRect?.();
    const usable = rect && rect.width >= 120 && rect.height >= 80;
    const signature = usable
      ? `${Math.round(rect.left)}:${Math.round(rect.top)}:${Math.round(rect.width)}:${Math.round(rect.height)}`
      : 'viewport';
    if (signature === this.lastRectSignature) return;
    this.lastRectSignature = signature;
    if (usable) {
      Object.assign(this.host.style, {
        inset: '',
        left: `${rect.left}px`,
        top: `${rect.top}px`,
        width: `${rect.width}px`,
        height: `${rect.height}px`,
      });
    } else {
      Object.assign(this.host.style, { inset: '0', left: '', top: '', width: '', height: '' });
    }
  }

  private startLoop(): void {
    if (this.frame) cancelAnimationFrame(this.frame);
    const tick = () => {
      this.renderFrame();
      this.frame = this.video && !this.video.paused ? requestAnimationFrame(tick) : undefined;
    };
    tick();
  }

  private renderFrame(): void {
    if (!this.video || !this.cueIndex || !this.settings.enabled || this.settings.displayMode === 'off') {
      this.hideSubtitle();
      return;
    }
    // Episode subtitles must never stay on screen over an advertisement, and
    // must never be matched against the ad's own clock.
    if (this.context?.isAdPlaying()) {
      this.hideSubtitle('ad');
      return;
    }
    // Safety net for layout changes no observer reported (a player expanding,
    // a sticky header collapsing). Throttled so it never costs a layout read
    // per frame.
    const sampleRectAt = performance.now();
    if (sampleRectAt - this.lastRectSyncAt >= 250) {
      this.lastRectSyncAt = sampleRectAt;
      this.positionToVideo();
    }
    const timeMs = Math.floor(this.video.currentTime * 1000);
    let cues = this.cueIndex.findAt(timeMs);
    let synchronization = 'time';
    const sampleAt = performance.now();
    if (sampleAt - this.lastNativeSampleAt >= 100) {
      this.lastNativeText = this.context?.getNativeSubtitleText?.() ?? '';
      this.lastNativeSampleAt = sampleAt;
    }
    const nativeText = this.lastNativeText;
    if (nativeText) {
      const textMatched = this.cueIndex.findBySourceText(nativeText, timeMs);
      // Prefer the cue the platform is demonstrably rendering. A downloadable
      // subtitle profile can use a shifted clock, in which case a time lookup
      // may return a different (but still translated) cue and look plausible.
      if (textMatched.some((cue) => cue.translatedText?.trim())) {
        cues = textMatched;
        synchronization = 'native-text';
      }
    }
    // A translator legitimately leaves some cues blank — music stings, sound
    // effects, on-screen signs. Showing the original for those beats showing a
    // gap, and the source line then omits them so the text is not doubled up.
    const hasTranslation = (cue: (typeof cues)[number]) => Boolean(cue.translatedText?.trim());
    const translation = cues
      .map((cue) => (hasTranslation(cue) ? cue.translatedText ?? '' : cue.sourceText))
      .filter(Boolean)
      .join('\n');
    const source = cues.filter(hasTranslation).map((cue) => cue.sourceText).filter(Boolean).join('\n');
    if (!translation) {
      this.hideSubtitle(cues.length ? synchronization : 'none');
      return;
    }
    const nativeVisible = Boolean(nativeText);
    const signature = [
      source,
      translation,
      this.settings.displayMode,
      this.settings.verticalPosition,
      nativeVisible,
      synchronization,
      cues.length,
    ].join('\u0000');
    if (signature === this.lastRenderSignature) return;
    this.lastRenderSignature = signature;
    this.host.dataset.activeCueCount = String(cues.length);
    this.host.dataset.synchronization = cues.length ? synchronization : 'none';
    this.host.dataset.sourceLength = String(source.length);
    this.host.dataset.translationLength = String(translation.length);
    this.sourceLine.textContent = source;
    this.translationLine.textContent = translation;
    // When the platform is already drawing the original cue, bilingual means
    // native source + our translation. Repeating the same source in our own
    // overlay produces a distracting three-line stack in-player.
    this.sourceLine.style.display = this.settings.displayMode === 'bilingual' && source && !nativeVisible ? '' : 'none';
    this.translationLine.style.display = translation ? '' : 'none';
    // `.subtitle` is hidden by default in the shadow stylesheet. An empty
    // inline value falls back to that rule, so showing it must be explicit.
    this.subtitle.style.display = translation ? 'block' : 'none';
    this.host.dataset.subtitleVisible = String(Boolean(translation));
    this.host.style.setProperty('--ft-bottom', `${Math.round((this.settings.verticalPosition + (nativeVisible ? 0.1 : 0)) * 100)}%`);
  }

  private hideSubtitle(synchronization = 'none'): void {
    const signature = `hidden\u0000${synchronization}`;
    if (signature === this.lastRenderSignature) return;
    this.lastRenderSignature = signature;
    this.subtitle.style.display = 'none';
    this.sourceLine.textContent = '';
    this.translationLine.textContent = '';
    this.host.dataset.activeCueCount = '0';
    this.host.dataset.synchronization = synchronization;
    this.host.dataset.sourceLength = '0';
    this.host.dataset.translationLength = '0';
    this.host.dataset.subtitleVisible = 'false';
  }
}

export function displayLanguage(tag: string): string {
  try {
    return new Intl.DisplayNames([uiLocale()], { type: 'language' }).of(tag) ?? tag;
  } catch {
    return tag;
  }
}
