import type { FlixTranslateSettings } from '../settings/schema';
import { isRtlLocale, t, uiLocale } from '../i18n';
import type { SubtitleTrack, TranslationStatus } from '../subtitles/models';
import { CueIndex } from './cue-index';

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
  private readonly panel: HTMLDivElement;
  private readonly statusText: HTMLDivElement;
  private readonly progress: HTMLProgressElement;
  private readonly actionRow: HTMLDivElement;
  private track: SubtitleTrack | undefined;
  private cueIndex: CueIndex | undefined;
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
        .subtitle{position:absolute;left:6%;right:6%;bottom:var(--ft-bottom,13%);display:none;text-align:center;pointer-events:none;filter:drop-shadow(0 2px 2px #000);line-height:1.22}
        .cue{display:table;margin:.12em auto;padding:.08em .32em;border-radius:.18em;background:rgba(0,0,0,.62);max-width:min(92%,72rem);white-space:pre-wrap;overflow-wrap:anywhere;unicode-bidi:plaintext}
        .source{font-size:calc(clamp(20px,3vw,44px)*var(--ft-scale,1)*.82);font-weight:500;color:#eee}
        .translation{font-size:calc(clamp(22px,3.25vw,50px)*var(--ft-scale,1));font-weight:650}
        .indicator{position:absolute;inset-inline-end:24px;bottom:24px;pointer-events:auto;border:1px solid rgba(255,255,255,.28);border-radius:999px;background:rgba(18,18,21,.82);color:#fff;font:700 12px/1 Arial,sans-serif;padding:8px 10px;cursor:pointer;box-shadow:0 2px 10px rgba(0,0,0,.35);opacity:1;transition:opacity .18s ease,transform .18s ease}
        .indicator.quiet{opacity:0;pointer-events:none;transform:translateY(4px)}
        .indicator:focus-visible,.panel button:focus-visible{outline:3px solid #fff;outline-offset:2px}
        .indicator[data-state="ready"]{border-color:#4fd18b}.indicator[data-state="failed"]{border-color:#ff6b73}
        .panel{position:absolute;inset-inline-end:24px;bottom:64px;width:280px;box-sizing:border-box;display:none;pointer-events:auto;border:1px solid rgba(255,255,255,.18);border-radius:16px;background:rgba(18,18,21,.96);backdrop-filter:blur(18px);color:#fff;padding:16px;box-shadow:0 18px 48px rgba(0,0,0,.58);font:14px/1.4 Arial,sans-serif}
        .panel.open{display:block}.title{font-weight:750;font-size:15px}.pair{color:#ddd;margin:5px 0 10px}.status{margin:8px 0}.progress{width:100%;accent-color:#d64b55;height:6px}.actions{display:flex;flex-wrap:wrap;gap:7px;margin-top:10px}
        .panel button{border:1px solid #555;border-radius:7px;background:#29292e;color:#fff;padding:7px 9px;cursor:pointer;font:inherit}.panel button:hover{background:#37373d}.panel button.primary{background:#c63f49;border-color:#c63f49}
        .modes{display:grid;gap:5px;margin-top:9px}.modes button{text-align:left}.footer{border-top:1px solid #3a3a3f;margin-top:11px;padding-top:10px;display:flex;justify-content:space-between}
        @media (max-width:700px){.indicator{inset-inline-end:14px;bottom:14px}.panel{inset-inline-end:14px;bottom:52px}.cue{max-width:96%}}
        @media (prefers-reduced-motion:no-preference){.panel{animation:ft-in .12s ease-out}@keyframes ft-in{from{opacity:0;transform:translateY(4px)}}}
        @media (prefers-reduced-motion:reduce){.indicator{transition:none}}
      </style>
      <div class="subtitle" aria-live="off"><div class="cue source" dir="auto"></div><div class="cue translation" dir="auto"></div></div>
      <button class="indicator" type="button" aria-label="${t('openQuickControls')}">FT</button>
      <section class="panel" aria-label="${t('quickControls')}">
        <div class="title">FlixTranslate</div><div class="pair" dir="auto"></div>
        <div class="status" role="status" aria-live="polite"></div><progress class="progress" max="1"></progress>
        <div class="actions"></div>
        <div class="modes" aria-label="${t('subtitleDisplayMode')}">
          <button type="button" data-mode="bilingual">${t('originalAndTranslation')}</button>
          <button type="button" data-mode="translation-only">${t('translationOnly')}</button>
          <button type="button" data-mode="off">${t('off')}</button>
        </div>
        <div class="footer"><button type="button" data-toggle>${t('turnOff')}</button><button type="button" data-settings>${t('openSettings')}</button></div>
      </section>`;
    this.subtitle = this.shadow.querySelector('.subtitle') as HTMLDivElement;
    this.sourceLine = this.shadow.querySelector('.source') as HTMLDivElement;
    this.translationLine = this.shadow.querySelector('.translation') as HTMLDivElement;
    this.indicator = this.shadow.querySelector('.indicator') as HTMLButtonElement;
    this.panel = this.shadow.querySelector('.panel') as HTMLDivElement;
    this.statusText = this.shadow.querySelector('.status') as HTMLDivElement;
    this.progress = this.shadow.querySelector('.progress') as HTMLProgressElement;
    this.actionRow = this.shadow.querySelector('.actions') as HTMLDivElement;
    this.indicator.addEventListener('click', () => {
      this.panel.classList.toggle('open');
      if (this.panel.classList.contains('open')) this.clearQuietTimer();
      else if (this.status.state === 'ready') this.scheduleQuietIndicator();
    });
    this.shadow.querySelectorAll<HTMLButtonElement>('[data-mode]').forEach((button) => {
      button.addEventListener('click', () => this.actions.onDisplayMode(button.dataset.mode as FlixTranslateSettings['displayMode']));
    });
    this.shadow.querySelector<HTMLButtonElement>('[data-toggle]')?.addEventListener('click', () => this.actions.onToggleEnabled());
    this.shadow.querySelector<HTMLButtonElement>('[data-settings]')?.addEventListener('click', () => this.actions.onOpenSettings());
    document.addEventListener('fullscreenchange', this.onFullscreen);
    document.addEventListener('pointermove', this.onPointerActivity, { passive: true });
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
    this.indicator.textContent = status.state === 'ready' ? 'FT ✓' : status.state === 'failed' ? 'FT !' : 'FT';
    this.updateIndicatorVisibility();
    const hasProgress = status.progress !== undefined && ['translating', 'downloading_model'].includes(status.state);
    this.progress.hidden = !hasProgress;
    if (hasProgress) this.progress.value = status.progress ?? 0;
    this.actionRow.replaceChildren();
    if (status.state === 'needs_user_activation') this.addAction(t('startTranslation'), 'primary', this.actions.onActivate);
    if (status.state === 'failed') this.addAction(t('retry'), 'primary', this.actions.onRetry);
    if (['needs_user_activation', 'failed', 'unsupported_image_track', 'no_text_track'].includes(status.state)) this.panel.classList.add('open');
    if (status.state === 'ready') {
      this.panel.classList.remove('open');
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
    const timeMs = Math.floor(this.video.currentTime * 1000);
    let cues = this.cueIndex.findAt(timeMs);
    let synchronization = 'time';
    const sampleAt = performance.now();
    if (sampleAt - this.lastNativeSampleAt >= 100) {
      this.lastNativeText = visibleNetflixSubtitleText();
      this.lastNativeSampleAt = sampleAt;
    }
    const nativeText = this.lastNativeText;
    if (nativeText) {
      const textMatched = this.cueIndex.findBySourceText(nativeText, timeMs);
      // Prefer the cue Netflix is demonstrably rendering. A downloadable TTML
      // profile can use a shifted clock, in which case a time lookup may return
      // a different (but still translated) cue and look plausibly successful.
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
    this.sourceLine.style.display = this.settings.displayMode === 'bilingual' && source ? '' : 'none';
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

function visibleNetflixSubtitleText(): string {
  const values = [...document.querySelectorAll<HTMLElement>('.player-timedtext-text-container,[data-uia="player-subtitle"]')]
    .filter((element) => {
      const own = getComputedStyle(element);
      const container = element.closest<HTMLElement>('.player-timedtext');
      const parent = container ? getComputedStyle(container) : undefined;
      const visible = (style?: CSSStyleDeclaration) => !style || (
        style.display !== 'none' &&
        style.visibility !== 'hidden' &&
        style.visibility !== 'collapse' &&
        style.opacity !== '0'
      );
      return visible(own) && visible(parent);
    })
    .map((element) => element.textContent?.trim() ?? '')
    .filter(Boolean);
  return [...new Set(values)].join('\n');
}

export function displayLanguage(tag: string): string {
  try {
    return new Intl.DisplayNames([uiLocale()], { type: 'language' }).of(tag) ?? tag;
  } catch {
    return tag;
  }
}
