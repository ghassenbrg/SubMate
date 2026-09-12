import type { FlixTranslateSettings } from '../settings/schema';
import { subtitleAppearanceVariables } from '../settings/appearance';
import { isRtlLocale, t, uiLocale } from '../i18n';
import type { SubtitleTrack, TranslationStatus } from '../subtitles/models';
import { CueIndex } from './cue-index';

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
  onDisplayMode(mode: FlixTranslateSettings['displayMode']): void;
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
  private settings: FlixTranslateSettings;
  private status: TranslationStatus = { state: 'idle' };
  private sourceLanguage: string | undefined;
  private targetLanguage: string | undefined;
  private lastNativeText = '';
  private lastNativeSampleAt = Number.NEGATIVE_INFINITY;
  private lastRenderSignature = '';
  private quietTimer: number | undefined;
  private readonly onTimeUpdate = () => {
    this.renderFrame();
    if (this.video && !this.video.paused && !this.frame) this.startLoop();
  };
  private readonly onFullscreen = () => this.mount();
  private readonly onPointerActivity = () => {
    if (!this.video || !this.settings.showPlayerStatus) return;
    this.indicator.classList.remove('quiet');
    if (this.status.state === 'ready') this.scheduleQuietIndicator();
  };
  private readonly onKeyDown = (event: KeyboardEvent) => {
    if (event.key === 'Escape' && this.panel.classList.contains('open')) {
      this.setPanelOpen(false);
      this.indicator.focus();
      if (this.status.state === 'ready') this.scheduleQuietIndicator();
    }
  };

  constructor(settings: FlixTranslateSettings, private readonly actions: OverlayActions) {
    document.getElementById('flixtranslate-root')?.remove();
    this.settings = settings;
    this.host = document.createElement('div');
    this.host.id = 'flixtranslate-root';
    this.host.setAttribute('data-flixtranslate', 'root');
    this.host.dir = isRtlLocale() ? 'rtl' : 'ltr';
    this.shadow = this.host.attachShadow({ mode: 'closed' });
    this.shadow.innerHTML = `
      <style>
        :host{all:initial;position:fixed;inset:0;z-index:2147483000;pointer-events:none;font-family:Inter,Arial,sans-serif;color:#fff}
        .subtitle{position:absolute;left:6%;right:6%;bottom:var(--ft-bottom,13%);display:none;text-align:center;pointer-events:none;line-height:var(--ft-line-height,1.22);opacity:var(--ft-opacity,1)}
        .cue{display:table;margin:.12em auto;padding:var(--ft-cue-padding,.1em .36em);border-radius:var(--ft-radius,.18em);background:var(--ft-background,rgba(0,0,0,.68));color:var(--ft-color,#fff);text-shadow:var(--ft-text-shadow,0 2px 3px #000);max-width:min(86%,62rem);white-space:pre-wrap;overflow-wrap:anywhere;unicode-bidi:plaintext}
        .source{font-size:calc(clamp(18px,2.1vw,32px)*var(--ft-scale,1));font-weight:500;opacity:.88}
        .translation{font-size:calc(clamp(20px,2.4vw,38px)*var(--ft-scale,1));font-weight:var(--ft-weight,650)}
        .indicator{position:absolute;inset-inline-end:22px;bottom:20px;display:grid;place-items:center;box-sizing:border-box;width:42px;height:42px;padding:0;pointer-events:auto;border:1px solid rgba(255,255,255,.32);border-radius:8px;background:rgba(16,16,20,.92);color:#fff;font:750 13px/1 Arial,sans-serif;cursor:pointer;box-shadow:0 2px 10px rgba(0,0,0,.45);opacity:1;transition:opacity .18s ease,transform .18s ease,background .16s ease,border-color .16s ease}
        .indicator:hover,.indicator[aria-expanded="true"]{background:rgba(48,48,58,.98);border-color:rgba(255,255,255,.62);transform:scale(1.08)}
        .indicator-state{position:absolute;inset-inline-end:2px;top:2px;display:grid;place-items:center;min-width:13px;height:13px;padding:0 1px;border-radius:999px;background:#34c980;color:#07150e;font:900 9px/1 Arial,sans-serif;box-shadow:0 0 0 2px rgba(10,10,13,.88)}
        .indicator-state:empty{display:none}.indicator[data-state="failed"] .indicator-state{background:#ff5b66;color:#fff}
        .indicator.quiet:not(:hover){opacity:0;pointer-events:none;transform:translateY(4px)}
        .indicator:focus-visible,.panel button:focus-visible{outline:3px solid #fff;outline-offset:2px}
        .panel{position:absolute;inset-inline-end:22px;bottom:70px;width:min(300px,calc(100vw - 28px));max-height:min(74vh,570px);overflow:auto;overscroll-behavior:contain;box-sizing:border-box;display:none;pointer-events:auto;border:1px solid rgba(255,255,255,.13);border-radius:18px;background:linear-gradient(155deg,rgba(39,20,43,.98),rgba(14,14,19,.98) 45%);backdrop-filter:blur(20px);color:#f8f8fa;padding:0;box-shadow:0 22px 58px rgba(0,0,0,.62);font:13px/1.4 Inter,Arial,sans-serif}
        .panel::before{content:"";position:absolute;inset:0 18px auto;height:2px;border-radius:0 0 3px 3px;background:linear-gradient(90deg,#b33ee1,#f04468)}
        .panel.open{display:block}.panel-head{display:grid;grid-template-columns:36px minmax(0,1fr);gap:11px;align-items:center;padding:16px 16px 13px}.panel-mark{display:grid;place-items:center;width:36px;height:36px;border-radius:11px;background:linear-gradient(145deg,#8c35d9,#f04468);box-shadow:0 7px 18px rgba(191,48,154,.28);font-weight:850;font-size:12px}.title{font-weight:780;font-size:16px;letter-spacing:-.015em}.pair{color:#c8c5ce;margin-top:2px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}.panel-body{padding:0 16px 15px}.status-card{border:1px solid rgba(255,255,255,.09);border-radius:11px;background:rgba(255,255,255,.055);padding:10px 11px}.status{display:flex;align-items:center;gap:8px;font-weight:650}.status::before{content:"";width:7px;height:7px;flex:0 0 auto;border-radius:999px;background:#9b9ba6}.panel[data-state="ready"] .status::before{background:#46d58d;box-shadow:0 0 0 3px rgba(70,213,141,.12)}.panel[data-state="failed"] .status::before{background:#ff6570}.progress{width:100%;accent-color:#ed4770;height:6px;margin-top:8px}.actions{display:flex;flex-wrap:wrap;gap:7px;margin-top:10px}
        .section-label{margin:14px 2px 7px;color:#9d99a6;font-size:10px;font-weight:800;letter-spacing:.15em;text-transform:uppercase}.panel button{border:1px solid rgba(255,255,255,.15);border-radius:9px;background:rgba(255,255,255,.07);color:#fff;padding:8px 10px;cursor:pointer;font:inherit;font-weight:650;transition:border-color .15s ease,background .15s ease,transform .15s ease}.panel button:hover{background:rgba(255,255,255,.12);border-color:rgba(255,255,255,.25)}.panel button.primary{background:linear-gradient(135deg,#aa3ddd,#ef4068);border-color:transparent}
        .modes{display:grid;gap:6px}.modes button{position:relative;text-align:left;padding:10px 36px 10px 11px}.modes button[aria-pressed="true"]{border-color:rgba(235,79,159,.75);background:linear-gradient(105deg,rgba(169,57,218,.28),rgba(240,68,104,.19));box-shadow:inset 3px 0 0 #e44d88}.modes button[aria-pressed="true"]::after{content:"✓";position:absolute;inset-inline-end:12px;color:#64dfa0;font-weight:900}.footer{border-top:1px solid rgba(255,255,255,.1);margin-top:13px;padding-top:11px;display:flex;justify-content:space-between;gap:8px}.footer button:last-child{margin-inline-start:auto}
        :host([dir="rtl"]) .modes button{text-align:right;padding:10px 11px 10px 36px}:host([dir="rtl"]) .modes button[aria-pressed="true"]{box-shadow:inset -3px 0 0 #e44d88}
        @media (max-width:700px){.indicator{inset-inline-end:12px;bottom:12px}.panel{inset-inline-end:12px;bottom:60px}.cue{max-width:94%}.translation{font-size:calc(clamp(18px,5vw,30px)*var(--ft-scale,1))}.source{font-size:calc(clamp(16px,4.3vw,25px)*var(--ft-scale,1))}}
        @media (prefers-reduced-motion:no-preference){.panel{animation:ft-in .12s ease-out}@keyframes ft-in{from{opacity:0;transform:translateY(4px)}}}
        @media (prefers-reduced-motion:reduce){.indicator{transition:none}}
      </style>
      <div class="subtitle" aria-live="off"><div class="cue source" dir="auto"></div><div class="cue translation" dir="auto"></div></div>
      <button class="indicator" type="button" aria-label="${t('openQuickControls')}" aria-controls="flixtranslate-quick-controls" aria-expanded="false"><span>FT</span><span class="indicator-state" aria-hidden="true"></span></button>
      <section class="panel" id="flixtranslate-quick-controls" aria-label="${t('quickControls')}">
        <div class="panel-head"><div class="panel-mark" aria-hidden="true">FT</div><div><div class="title">FlixTranslate</div><div class="pair" dir="auto"></div></div></div>
        <div class="panel-body">
          <div class="status-card"><div class="status" role="status" aria-live="polite"></div><progress class="progress" max="1"></progress><div class="actions"></div></div>
          <div class="section-label">${t('display')}</div>
          <div class="modes" aria-label="${t('subtitleDisplayMode')}">
            <button type="button" data-mode="bilingual" aria-pressed="false">${t('originalAndTranslation')}</button>
            <button type="button" data-mode="translation-only" aria-pressed="false">${t('translationOnly')}</button>
            <button type="button" data-mode="off" aria-pressed="false">${t('off')}</button>
          </div>
          <div class="footer"><button type="button" data-toggle>${t('turnOff')}</button><button type="button" data-settings>${t('openSettings')}</button></div>
        </div>
      </section>`;
    this.subtitle = this.shadow.querySelector('.subtitle') as HTMLDivElement;
    this.sourceLine = this.shadow.querySelector('.source') as HTMLDivElement;
    this.translationLine = this.shadow.querySelector('.translation') as HTMLDivElement;
    this.indicator = this.shadow.querySelector('.indicator') as HTMLButtonElement;
    this.indicatorState = this.shadow.querySelector('.indicator-state') as HTMLSpanElement;
    this.panel = this.shadow.querySelector('.panel') as HTMLDivElement;
    this.statusText = this.shadow.querySelector('.status') as HTMLDivElement;
    this.progress = this.shadow.querySelector('.progress') as HTMLProgressElement;
    this.actionRow = this.shadow.querySelector('.actions') as HTMLDivElement;
    this.indicator.addEventListener('click', () => {
      this.setPanelOpen(!this.panel.classList.contains('open'));
      if (this.panel.classList.contains('open')) this.clearQuietTimer();
      else if (this.status.state === 'ready') this.scheduleQuietIndicator();
    });
    // Holding the pointer still over the control produces no further pointermove
    // events, so without these the quiet timer would fade it out from under the
    // cursor the user is aiming with.
    this.indicator.addEventListener('pointerenter', () => this.clearQuietTimer());
    this.indicator.addEventListener('pointerleave', () => {
      if (this.status.state === 'ready') this.scheduleQuietIndicator();
    });
    this.shadow.querySelectorAll<HTMLButtonElement>('[data-mode]').forEach((button) => {
      button.addEventListener('click', () => {
        const mode = button.dataset.mode as FlixTranslateSettings['displayMode'];
        this.updateModeSelection(mode);
        this.actions.onDisplayMode(mode);
      });
    });
    this.shadow.querySelector<HTMLButtonElement>('[data-toggle]')?.addEventListener('click', () => this.actions.onToggleEnabled());
    this.shadow.querySelector<HTMLButtonElement>('[data-settings]')?.addEventListener('click', () => this.actions.onOpenSettings());
    document.addEventListener('fullscreenchange', this.onFullscreen);
    document.addEventListener('pointermove', this.onPointerActivity, { passive: true });
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

  applySettings(settings: FlixTranslateSettings): void {
    this.settings = settings;
    this.host.style.setProperty('--ft-scale', String(settings.translatedFontScale));
    this.host.style.setProperty('--ft-bottom', `${Math.round(settings.verticalPosition * 100)}%`);
    for (const [property, value] of Object.entries(subtitleAppearanceVariables(settings))) {
      this.host.style.setProperty(property, value);
    }
    this.updateModeSelection(settings.displayMode);
    this.host.style.display = settings.enabled ? '' : 'none';
    const toggle = this.shadow.querySelector<HTMLButtonElement>('[data-toggle]');
    if (toggle) toggle.textContent = settings.enabled ? t('turnOff') : t('turnOn');
    this.updateIndicatorVisibility();
    this.renderFrame();
  }

  setStatus(status: TranslationStatus): void {
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
    if (status.state === 'ready') {
      this.setPanelOpen(false);
      this.scheduleQuietIndicator();
    } else {
      this.clearQuietTimer();
      this.indicator.classList.remove('quiet');
    }
  }

  destroy(): void {
    if (this.frame) cancelAnimationFrame(this.frame);
    this.clearQuietTimer();
    document.removeEventListener('fullscreenchange', this.onFullscreen);
    document.removeEventListener('pointermove', this.onPointerActivity);
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
  }

  private updateModeSelection(mode: FlixTranslateSettings['displayMode']): void {
    this.shadow.querySelectorAll<HTMLButtonElement>('[data-mode]').forEach((button) => {
      button.setAttribute('aria-pressed', String(button.dataset.mode === mode));
    });
  }

  private updateIndicatorVisibility(): void {
    const actionable = ['needs_user_activation', 'failed', 'unsupported_image_track', 'no_text_track'].includes(this.status.state);
    const visible = Boolean(this.video && (this.settings.showPlayerStatus || actionable));
    this.indicator.style.display = visible ? '' : 'none';
    if (!visible) this.clearQuietTimer();
    else if (actionable) this.indicator.classList.remove('quiet');
    else if (this.status.state === 'ready') {
      this.indicator.classList.remove('quiet');
      this.scheduleQuietIndicator();
    }
  }

  private scheduleQuietIndicator(): void {
    this.clearQuietTimer();
    if (!this.video || !this.settings.showPlayerStatus || this.panel.classList.contains('open')) return;
    this.quietTimer = window.setTimeout(() => {
      this.quietTimer = undefined;
      if (this.status.state === 'ready' && !this.panel.classList.contains('open')) this.indicator.classList.add('quiet');
    }, 2_500);
  }

  private clearQuietTimer(): void {
    if (this.quietTimer !== undefined) window.clearTimeout(this.quietTimer);
    this.quietTimer = undefined;
  }

  private mount(): void {
    const fullscreen = document.fullscreenElement;
    if (fullscreen) {
      fullscreen.append(this.host);
      Object.assign(this.host.style, { position: 'absolute', inset: '0', left: '', top: '', width: '', height: '' });
    } else {
      document.documentElement.append(this.host);
      Object.assign(this.host.style, { position: 'fixed', inset: '0' });
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
    const source = cues.map((cue) => cue.sourceText).filter(Boolean).join('\n');
    const translation = cues.map((cue) => cue.translatedText ?? '').filter(Boolean).join('\n');
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
