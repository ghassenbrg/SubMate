import { sendCacheMessage } from '../../cache/messages';
import { applyDocumentLocale, t } from '../../i18n';
import { loadSettings } from '../../settings/store';
import type { SubMateSettings } from '../../settings/schema';
import { appearanceForPreset, subtitleAppearanceVariables } from '../../settings/appearance';
import { createLanguagePicker } from '../shared/language-picker';
import { sendContent } from '../shared/messages';
import { saveSettingsForAllTabs } from '../shared/tab-settings';
import { hasCloudApiKey, saveCloudApiKey } from '../../translation/cloud/credentials';
import {
  CLOUD_PROVIDERS,
  CUSTOM_PROVIDER_ID,
  cloudProvider,
  detectProviderFromKey,
  normalizeBaseUrl,
  originPattern,
  resolveEndpoint,
} from '../../translation/cloud/providers';
import { hasHostPermission } from '../../translation/cloud/readiness';
import { createThemeToggle, initTheme } from '../shared/theme';
import { createDisplayModeTiles } from '../shared/display-mode';

const appNode = document.querySelector<HTMLElement>('#app');
if (!appNode) throw new Error('Options root missing');
const app = appNode;
initTheme();
applyDocumentLocale();
let settings: SubMateSettings;
let stats: { translations: number; sources: number };
let storageUsage: number | undefined;
let debugInfo: Record<string, unknown> | undefined;
let appearancePreview: HTMLDivElement | undefined;
let sectionObserver: IntersectionObserver | undefined;

const el = <K extends keyof HTMLElementTagNameMap>(tag: K, className?: string, text?: string): HTMLElementTagNameMap[K] => {
  const node = document.createElement(tag); if (className) node.className = className; if (text !== undefined) node.textContent = text; return node;
};

/** One glyph per settings section so the sidebar reads at a glance, not just as a list of words. */
const NAV_ICON_PATHS = {
  general: 'M4 7h5m4 0h7M4 17h11m4 0h1M11 4.5v5M17 14.5v5',
  translation: 'M12 3a9 9 0 1 0 0 18 9 9 0 0 0 0-18Zm-9 9h18M12 3c2.4 2.6 2.4 12.4 0 18M12 3c-2.4 2.6-2.4 12.4 0 18',
  appearance: 'm12 3.6 2.6 5.3 5.8.8-4.2 4.1 1 5.8-5.2-2.7-5.2 2.7 1-5.8-4.2-4.1 5.8-.8z',
  storage: 'M4 6c0-1.4 3.6-2.5 8-2.5s8 1.1 8 2.5-3.6 2.5-8 2.5S4 7.4 4 6Zm0 0v6c0 1.4 3.6 2.5 8 2.5s8-1.1 8-2.5V6m-16 6v6c0 1.4 3.6 2.5 8 2.5s8-1.1 8-2.5v-6',
  about: 'M12 21a9 9 0 1 0 0-18 9 9 0 0 0 0 18Zm0-8.5V16m0-6.75h.01',
} as const;

/** Section heading styled as a full-width band, matching the popup's groups. */
function sectionHeading(name: keyof typeof NAV_ICON_PATHS, label: string): HTMLHeadingElement {
  const heading = el('h2');
  heading.append(navIcon(name), el('span', '', label));
  return heading;
}

function navIcon(name: keyof typeof NAV_ICON_PATHS): SVGSVGElement {
  const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  svg.setAttribute('class', 'icon');
  svg.setAttribute('viewBox', '0 0 24 24');
  svg.setAttribute('fill', 'none');
  svg.setAttribute('aria-hidden', 'true');
  const path = document.createElementNS('http://www.w3.org/2000/svg', 'path');
  path.setAttribute('d', NAV_ICON_PATHS[name]);
  path.setAttribute('stroke', 'currentColor');
  path.setAttribute('stroke-width', '1.8');
  path.setAttribute('stroke-linecap', 'round');
  path.setAttribute('stroke-linejoin', 'round');
  svg.append(path);
  return svg;
}

/**
 * Highlights the nav entry for whichever section is in view. Sections are
 * rebuilt on every render(), so the observer is recreated each time rather
 * than reused across a stale DOM.
 */
function setupScrollSpy(navLinks: HTMLAnchorElement[]): void {
  sectionObserver?.disconnect();
  if (typeof IntersectionObserver === 'undefined') return;
  const sections = navLinks
    .map((link) => document.getElementById(link.dataset.section ?? ''))
    .filter((section): section is HTMLElement => Boolean(section));
  sectionObserver = new IntersectionObserver((entries) => {
    for (const entry of entries) {
      if (!entry.isIntersecting) continue;
      for (const link of navLinks) link.classList.toggle('active', link.dataset.section === entry.target.id);
    }
  }, { rootMargin: '-15% 0px -70% 0px', threshold: 0 });
  for (const section of sections) sectionObserver.observe(section);
}

const row = (label: string, control: HTMLElement, help?: string) => {
  const wrapper = el('div', 'row');
  if (control instanceof HTMLInputElement || control instanceof HTMLSelectElement) control.setAttribute('aria-label', label);
  const text = el('span'); text.append(el('strong', '', label)); if (help) text.append(el('small', '', help));
  wrapper.append(text, control); return wrapper;
};

function toggle(checked: boolean, onChange: (checked: boolean) => void): HTMLInputElement {
  const input = el('input') as HTMLInputElement; input.type = 'checkbox'; input.role = 'switch'; input.checked = checked;
  input.addEventListener('change', () => onChange(input.checked)); return input;
}

/**
 * Plus/minus stepper for values people nudge rather than sweep. Clicking a
 * target twice the size of a slider thumb is a far easier way to go one step
 * up, and the reading stays visible instead of living on the handle.
 */
function stepperControl(
  value: number,
  min: number,
  max: number,
  step: number,
  label: string,
  format: (value: number) => string,
  onChange: (value: number) => void,
): HTMLDivElement {
  const wrapper = el('div', 'stepper');
  let current = value;
  const reading = el('output', '', format(current));
  const display = el('span', 'stepper-value');
  display.append(el('span', 'stepper-glyph', 'A'), reading);

  const nudge = (direction: -1 | 1, glyph: string, aria: string) => {
    const button = el('button', '', glyph) as HTMLButtonElement;
    button.type = 'button';
    button.setAttribute('aria-label', aria);
    button.addEventListener('click', () => {
      // Rounded to the step grid: repeated float addition otherwise lands on
      // values like 1.1500000000000001 and the reading shows the drift.
      const next = Math.min(max, Math.max(min, Math.round((current + direction * step) / step) * step));
      if (next === current) return;
      current = next;
      reading.value = format(current);
      onChange(current);
    });
    return button;
  };

  wrapper.append(nudge(-1, '−', t('decreaseSetting', label)), display, nudge(1, '+', t('increaseSetting', label)));
  return wrapper;
}

function rangeControl(
  value: number,
  min: number,
  max: number,
  step: number,
  label: string,
  format: (value: number) => string,
  onChange: (value: number) => void,
): HTMLDivElement {
  const wrapper = el('div', 'range-control');
  const input = el('input') as HTMLInputElement;
  const output = el('output', '', format(value));
  input.type = 'range'; input.min = String(min); input.max = String(max); input.step = String(step); input.value = String(value);
  input.setAttribute('aria-label', label);
  input.addEventListener('input', () => {
    const next = Number(input.value);
    output.value = format(next);
    onChange(next);
  });
  wrapper.append(input, output);
  return wrapper;
}

function applyAppearancePreview(preview: HTMLElement, value: SubMateSettings): void {
  for (const [property, cssValue] of Object.entries(subtitleAppearanceVariables(value))) {
    preview.style.setProperty(property, cssValue);
  }
  preview.style.setProperty('--ft-scale', String(value.translatedFontScale));
  // Lets the vertical-position slider show where the cue actually lands rather
  // than only reporting a percentage.
  preview.style.setProperty('--ft-position', `${Math.round(value.verticalPosition * 100)}%`);
}

function subtitleStylePicker(): HTMLDivElement {
  const picker = el('div', 'style-picker');
  const presets: Array<[Exclude<SubMateSettings['subtitleStylePreset'], 'custom'>, string]> = [
    ['netflix', t('netflixStyle')],
    ['soft-box', t('softBoxStyle')],
    ['solid-box', t('solidBoxStyle')],
    ['outline', t('outlineStyle')],
    ['minimal', t('minimalStyle')],
  ];
  for (const [preset, label] of presets) {
    const button = el('button', 'style-tile') as HTMLButtonElement;
    button.type = 'button';
    button.dataset.preset = preset;
    button.setAttribute('aria-pressed', String(settings.subtitleStylePreset === preset));
    const sample = el('span', 'style-tile-sample');
    sample.append(el('span', 'style-tile-cue', 'Aa'));
    const name = el('span', 'style-tile-name', label);
    button.append(sample, name);
    button.addEventListener('click', () => void update(appearanceForPreset(preset)));
    picker.append(button);
  }
  const custom = el('button', 'style-tile custom-tile') as HTMLButtonElement;
  custom.type = 'button';
  custom.dataset.preset = 'custom';
  custom.setAttribute('aria-pressed', String(settings.subtitleStylePreset === 'custom'));
  const customSample = el('span', 'style-tile-sample');
  customSample.append(el('span', 'style-tile-cue', '✦'));
  custom.append(customSample, el('span', 'style-tile-name', t('customStyle')));
  custom.addEventListener('click', () => void update({ subtitleStylePreset: 'custom' }));
  picker.append(custom);
  return picker;
}

function render(): void {
  app.replaceChildren();
  const header = el('header');
  const icon = el('img', 'brand-icon') as HTMLImageElement; icon.src = 'icons/icon.svg'; icon.alt = ''; icon.width = 48; icon.height = 48;
  header.append(icon, el('div'));
  header.lastElementChild?.append(el('h1', '', t('settingsTitle')), el('p', '', t('settingsSubtitle')));
  const headerActions = el('div', 'header-actions');
  headerActions.append(createThemeToggle(), el('span', 'version-pill', `v${chrome.runtime.getManifest().version}`));
  header.append(headerActions);
  app.append(header);

  const layout = el('div', 'settings-layout');
  const navigation = el('nav', 'settings-nav');
  navigation.setAttribute('aria-label', t('settingsTitle'));
  const content = el('div', 'settings-content');
  const sections: Array<[keyof typeof NAV_ICON_PATHS, string]> = [
    ['general', t('general')],
    ['translation', t('translation')],
    ['appearance', t('appearance')],
    ['storage', t('storage')],
    ['about', t('about')],
  ];
  const navLinks: HTMLAnchorElement[] = [];
  for (const [id, label] of sections) {
    const link = el('a', 'settings-nav-link') as HTMLAnchorElement;
    link.href = `#${id}`;
    link.dataset.section = id;
    link.append(navIcon(id), el('span', '', label));
    navigation.append(link);
    navLinks.push(link);
  }

  const contentIntro = el('div', 'settings-content-intro');
  contentIntro.append(el('span', 'eyebrow', t('settingsTitle').toUpperCase()), el('p', '', t('settingsSubtitle')));
  content.append(contentIntro);

  const general = el('section'); general.id = 'general'; general.append(sectionHeading('general', t('general')));
  general.append(row(t('enableSubMate'), toggle(settings.enabled, (enabled) => void update({ enabled }))));
  // Manual mode returns before auto-translation is ever considered, so the
  // toggle would sit there doing nothing.
  if (settings.translationEngine !== 'manual') {
    general.append(row(t('autoTranslateEpisodes'), toggle(settings.autoTranslate, (autoTranslate) => void update({ autoTranslate }))));
  }
  const target = createLanguagePicker({
    value: settings.preferredTargetLanguage,
    label: t('targetLanguage'),
    onCommit: (language) => { if (language) void update({ preferredTargetLanguage: language }); },
  });
  general.append(row(t('targetLanguage'), target, t('targetLanguageHelp')));
  const source = createLanguagePicker({
    ...(settings.preferredSourceLanguage ? { value: settings.preferredSourceLanguage } : {}),
    allowAutomatic: true,
    label: t('preferredSourceLanguage'),
    onCommit: (language) => void update({ preferredSourceLanguage: language }),
  });
  general.append(row(t('preferredSourceLanguage'), source, t('sourceLanguageHelp')));
  content.append(general);

  const translation = el('section'); translation.id = 'translation'; translation.append(sectionHeading('translation', t('translation')));
  const engine = el('select') as HTMLSelectElement;
  engine.append(
    new Option(t('onDevice'), 'chrome-local'),
    new Option(t('cloudTranslation'), 'cloud-api'),
    new Option(t('manualTranslation'), 'manual'),
  );
  engine.value = settings.translationEngine;
  engine.addEventListener('change', () => void update({ translationEngine: engine.value as SubMateSettings['translationEngine'] }));
  translation.append(row(t('engine'), engine, t('engineHelp')));
  if (settings.translationEngine === 'cloud-api') translation.append(cloudSection());
  content.append(translation);

  const appearance = el('section'); appearance.id = 'appearance'; appearance.classList.add('appearance-section'); appearance.append(sectionHeading('appearance', t('appearance')));
  const preset = subtitleStylePicker();
  const mode = createDisplayModeTiles(settings.displayMode, (displayMode) => void update({ displayMode }));
  const background = el('select') as HTMLSelectElement;
  background.append(new Option(t('backgroundNone'), 'none'), new Option(t('backgroundSoft'), 'soft'), new Option(t('backgroundSolid'), 'solid'));
  background.value = settings.subtitleBackground;
  background.addEventListener('change', () => void update({ subtitleStylePreset: 'custom', subtitleBackground: background.value as SubMateSettings['subtitleBackground'] }));
  const outline = el('select') as HTMLSelectElement;
  outline.append(new Option(t('outlineNone'), 'none'), new Option(t('outlineShadow'), 'shadow'), new Option(t('outlineStrong'), 'outline'));
  outline.value = settings.subtitleOutline;
  outline.addEventListener('change', () => void update({ subtitleStylePreset: 'custom', subtitleOutline: outline.value as SubMateSettings['subtitleOutline'] }));
  const color = el('input') as HTMLInputElement; color.type = 'color'; color.value = settings.subtitleTextColor; color.setAttribute('aria-label', t('textColor'));
  color.addEventListener('change', () => void update({ subtitleStylePreset: 'custom', subtitleTextColor: color.value }));
  const weight = el('select') as HTMLSelectElement;
  for (const value of [400, 500, 600, 650, 700, 800]) weight.append(new Option(String(value), String(value)));
  weight.value = String(settings.translatedFontWeight);
  weight.addEventListener('change', () => void update({ subtitleStylePreset: 'custom', translatedFontWeight: Number(weight.value) }));
  const scale = stepperControl(settings.translatedFontScale, .7, 1.8, .05, t('fontSize'), (value) => `${Math.round(value * 100)}%`, (translatedFontScale) => void update({ translatedFontScale }, false));
  const position = rangeControl(settings.verticalPosition, .04, .42, .01, t('verticalPosition'), (value) => `${Math.round(value * 100)}%`, (verticalPosition) => void update({ verticalPosition }, false));
  const opacity = rangeControl(settings.subtitleOpacity, .5, 1, .05, t('subtitleOpacity'), (value) => `${Math.round(value * 100)}%`, (subtitleOpacity) => void update({ subtitleStylePreset: 'custom', subtitleOpacity }, false));
  const lineHeight = rangeControl(settings.subtitleLineHeight, 1, 1.6, .05, t('lineSpacing'), (value) => value.toFixed(2).replace(/0$/, ''), (subtitleLineHeight) => void update({ subtitleStylePreset: 'custom', subtitleLineHeight }, false));
  const preview = el('div', 'subtitle-preview');
  preview.setAttribute('role', 'img'); preview.setAttribute('aria-label', t('stylePreview'));
  preview.append(el('span', 'preview-label', t('stylePreview')));
  const sample = el('div', 'preview-subtitle');
  sample.append(el('div', 'preview-cue preview-source', t('previewOriginal')), el('div', 'preview-cue preview-translation', t('previewTranslation')));
  preview.append(sample); appearancePreview = preview; applyAppearancePreview(preview, settings);
  // With the display off nothing is drawn, so every style control below would
  // be adjusting something invisible. The mode itself stays, as the way back.
  const subtitlesVisible = settings.displayMode !== 'off';
  if (subtitlesVisible) appearance.append(preview);
  appearance.append(row(t('displayMode'), mode));
  if (subtitlesVisible) {
    appearance.append(
      row(t('subtitleStylePreset'), preset, t('appearancePresetHelp')),
      row(t('fontSize'), scale),
      row(t('verticalPosition'), position),
    );
    // The preset already sets all six of these; they open automatically once a
    // preset has been departed from.
    const tune = el('details', 'tune');
    tune.open = settings.subtitleStylePreset === 'custom';
    tune.append(
      el('summary', '', t('fineTuneStyle')),
      row(t('subtitleBackground'), background),
      row(t('textOutline'), outline),
      row(t('textColor'), color),
      row(t('fontWeight'), weight),
      row(t('subtitleOpacity'), opacity),
      row(t('lineSpacing'), lineHeight),
    );
    appearance.append(tune);
  } else {
    appearance.append(el('p', 'section-note', t('appearanceOffNote')));
  }
  // The in-player control is how the user turns subtitles back on, so it stays
  // available even when the display is off.
  appearance.append(row(t('showPlayerStatus'), toggle(settings.showPlayerStatus, (showPlayerStatus) => void update({ showPlayerStatus }))));
  const reset = el('button', 'link-row', t('resetAppearance')); reset.addEventListener('click', () => void update({
    displayMode: 'bilingual', translatedFontScale: 1, verticalPosition: .13, showPlayerStatus: true, ...appearanceForPreset('soft-box'),
  })); appearance.append(reset);
  content.append(appearance);

  const storage = el('section'); storage.id = 'storage'; storage.append(sectionHeading('storage', t('storage')), el('p', 'stat', t('cachedItems', [String(stats.translations), String(stats.sources)])));
  if (storageUsage !== undefined) storage.append(el('p', 'stat', t('extensionStorageUsed', formatBytes(storageUsage))));
  const clear = el('button', 'danger', t('clearCache')); clear.addEventListener('click', async () => {
    if (!confirm(t('clearCacheConfirm', String(stats.translations)))) return;
    await sendCacheMessage<void>({ type: 'CACHE_CLEAR' }); stats = { translations: 0, sources: 0 }; render();
  }); storage.append(clear); content.append(storage);

  const about = el('section'); about.id = 'about'; about.append(sectionHeading('about', t('about')), el('p', '', t('version', chrome.runtime.getManifest().version)), el('p', '', t('independentNotice')), el('p', '', t('noTelemetryNotice')));
  about.append(row(t('developerDiagnostics'), toggle(settings.debugMode, (debugMode) => void update({ debugMode }))));
  if (settings.debugMode) about.append(el('pre', 'debug', JSON.stringify(debugInfo ?? { message: t('diagnosticsHint') }, null, 2)));
  content.append(about);
  layout.append(navigation, content);
  app.append(layout);
  navLinks[0]?.classList.add('active');
  setupScrollSpy(navLinks);
}

/**
 * Diagnostics are read from the player tab, which can change at any moment, so
 * they are refetched on demand rather than only once at page load. Without
 * this, switching the toggle on showed the "open an episode" hint even with an
 * episode already playing in another tab.
 */
async function refreshDiagnostics(rerender = true): Promise<void> {
  try {
    debugInfo = await sendContent<Record<string, unknown>>({ type: 'CONTENT_GET_DEBUG' }, { anyTab: true });
  } catch {
    debugInfo = undefined;
  }
  if (rerender) render();
}

let diagnosticsTimer: number | undefined;

/** Polls while the panel is open so the values track playback. */
function syncDiagnosticsPolling(): void {
  const wanted = settings.debugMode;
  if (wanted && diagnosticsTimer === undefined) {
    diagnosticsTimer = window.setInterval(() => {
      if (document.visibilityState === 'visible') void refreshDiagnostics();
    }, 1_500);
  } else if (!wanted && diagnosticsTimer !== undefined) {
    window.clearInterval(diagnosticsTimer);
    diagnosticsTimer = undefined;
  }
}

addEventListener('pagehide', () => {
  if (diagnosticsTimer !== undefined) window.clearInterval(diagnosticsTimer);
  diagnosticsTimer = undefined;
}, { once: true });

/** A one-shot notice that survives the re-render a settings change triggers. */
let cloudNotice = '';

/**
 * Asks for access to a provider's host. Must run inside the user gesture that
 * chose it, so callers invoke it before awaiting anything else.
 */
const requestHostAccess = (baseUrl: string): Promise<boolean> =>
  chrome.permissions.request({ origins: [originPattern(baseUrl)] }).catch(() => false);

/**
 * Cloud engine configuration.
 *
 * The stored key is never rendered back into the DOM — only whether one exists.
 * That keeps the secret out of the page, out of screenshots and out of any
 * accessibility tree a screen reader or automation might walk.
 */
function cloudSection(): HTMLElement {
  const section = el('div', 'cloud-section');
  section.append(el('h3', '', t('cloudSection')));

  const warning = el('p', 'cloud-warning', t('cloudPrivacyWarning'));
  warning.setAttribute('role', 'note');
  section.append(warning);

  const provider = cloudProvider(settings.cloudVendor);
  const isCustom = provider.id === CUSTOM_PROVIDER_ID;
  const label = (id: string) => (id === CUSTOM_PROVIDER_ID ? t('cloudProviderCustom') : cloudProvider(id).label);

  if (cloudNotice) {
    const notice = el('p', 'cloud-notice', cloudNotice);
    notice.setAttribute('role', 'status');
    section.append(notice);
    cloudNotice = '';
  }

  const vendor = el('select') as HTMLSelectElement;
  for (const option of CLOUD_PROVIDERS) vendor.append(new Option(label(option.id), option.id));
  vendor.value = provider.id;
  vendor.addEventListener('change', () => {
    const next = cloudProvider(vendor.value);
    if (next.baseUrl) void requestHostAccess(next.baseUrl);
    // A model name from one provider means nothing to another.
    void update({ cloudVendor: next.id, cloudModel: '' });
  });
  section.append(row(t('cloudVendorLabel'), vendor));

  if (isCustom) {
    const baseUrl = el('input') as HTMLInputElement;
    baseUrl.type = 'text';
    baseUrl.inputMode = 'url';
    baseUrl.spellcheck = false;
    baseUrl.value = settings.cloudBaseUrl;
    baseUrl.placeholder = 'http://localhost:11434/v1';
    const baseUrlRow = row(t('cloudBaseUrl'), baseUrl, t('cloudBaseUrlHelp'));
    baseUrl.addEventListener('change', () => {
      const normalized = normalizeBaseUrl(baseUrl.value);
      if (baseUrl.value.trim() && !normalized) {
        baseUrlRow.querySelector('small')!.textContent = t('cloudBaseUrlInvalid');
        return;
      }
      if (normalized) void requestHostAccess(normalized);
      void update({ cloudBaseUrl: normalized ?? '' });
    });
    section.append(baseUrlRow);
  }

  const keyState = el('small', 'cloud-key-state', t('cloudApiKeyMissing'));
  void hasCloudApiKey(provider.id).then((present) => {
    keyState.textContent = present ? t('cloudApiKeySaved') : t('cloudApiKeyMissing');
  });

  const key = el('input') as HTMLInputElement;
  key.type = 'password';
  key.autocomplete = 'off';
  key.spellcheck = false;
  key.placeholder = t('cloudApiKeyPlaceholder');
  key.setAttribute('aria-label', t('cloudApiKey'));
  key.addEventListener('change', () => {
    const value = key.value;
    // Clear the field immediately so the secret does not linger in the DOM.
    key.value = '';
    // A recognizable key picks its own provider. Never from Custom, though:
    // gateways such as LiteLLM hand out keys that look like OpenAI's.
    const detected = detectProviderFromKey(value);
    const target = detected && !isCustom && detected.id !== provider.id ? detected : provider;
    const endpoint = resolveEndpoint({ ...settings, cloudVendor: target.id, ...(target === provider ? {} : { cloudModel: '' }) });
    if (value.trim() && endpoint) void requestHostAccess(endpoint.baseUrl);
    void saveCloudApiKey(target.id, value).then(async () => {
      if (target !== provider) {
        cloudNotice = t('cloudKeyDetected', target.label);
        await update({ cloudVendor: target.id, cloudModel: '' });
        return;
      }
      keyState.textContent = (await hasCloudApiKey(provider.id)) ? t('cloudApiKeySaved') : t('cloudApiKeyMissing');
    });
  });
  section.append(row(t('cloudApiKey'), key, isCustom ? t('cloudApiKeyOptional') : t('cloudApiKeyHelp')), keyState);

  const keyActions = el('div', 'cloud-key-actions');
  const clear = el('button', 'secondary', t('cloudApiKeyClear'));
  clear.type = 'button';
  clear.addEventListener('click', () => {
    void saveCloudApiKey(provider.id, '').then(() => { keyState.textContent = t('cloudApiKeyMissing'); });
  });
  keyActions.append(clear);
  if (provider.keyUrl) {
    const getKey = el('a', 'cloud-get-key', t('cloudGetKey', provider.label));
    getKey.href = provider.keyUrl;
    getKey.target = '_blank';
    getKey.rel = 'noopener noreferrer';
    keyActions.append(getKey);
  }
  section.append(keyActions);

  const model = el('input') as HTMLInputElement;
  model.type = 'text';
  model.spellcheck = false;
  model.value = settings.cloudModel;
  model.placeholder = provider.defaultModel ?? '';
  const suggestions = el('datalist');
  suggestions.id = 'cloud-model-suggestions';
  model.setAttribute('list', suggestions.id);
  model.addEventListener('change', () => void update({ cloudModel: model.value.trim() }));
  const modelHelp = isCustom && !settings.cloudModel ? t('cloudModelRequired') : t('cloudModelHelp');
  section.append(row(t('cloudModel'), model, modelHelp), suggestions);

  // Access is per host, so it can be granted before a model is chosen.
  const host = provider.baseUrl ?? (normalizeBaseUrl(settings.cloudBaseUrl) || undefined);
  if (host) {
    const permission = el('div', 'cloud-permission');
    permission.hidden = true;
    const grant = el('button', 'secondary', t('cloudPermissionGrant'));
    grant.type = 'button';
    grant.addEventListener('click', () => void requestHostAccess(host).then(() => render()));
    permission.append(el('span', '', t('cloudPermissionNeeded', new URL(host).host)), grant);
    section.append(permission);
    void hasHostPermission(host).then(async (granted) => {
      permission.hidden = granted;
      if (!granted) return;
      // Live model list, so a retired default is easy to replace. Best effort.
      const response = await chrome.runtime.sendMessage({ type: 'TRANSLATE_MODELS' }).catch(() => undefined);
      const ids: unknown = response?.ok ? response.value : [];
      if (Array.isArray(ids)) suggestions.replaceChildren(...ids.map((id) => new Option(String(id))));
    });
  }

  return section;
}

async function update(patch: Partial<SubMateSettings>, rerender = true): Promise<void> {
  const wasDebug = settings.debugMode;
  // The options page speaks for every tab: a per-tab setting changed here
  // replaces whatever each open tab had chosen for itself.
  settings = await saveSettingsForAllTabs(patch);
  syncDiagnosticsPolling();
  if (!wasDebug && settings.debugMode) {
    await refreshDiagnostics();
    return;
  }
  if (rerender) render();
  else {
    app.querySelectorAll<HTMLButtonElement>('.style-tile').forEach((tile) => {
      tile.setAttribute('aria-pressed', String(tile.dataset.preset === settings.subtitleStylePreset));
    });
    if (appearancePreview?.isConnected) applyAppearancePreview(appearancePreview, settings);
  }
}

void (async () => {
  settings = await loadSettings();
  stats = await sendCacheMessage<{ translations: number; sources: number }>({ type: 'CACHE_STATS' });
  storageUsage = (await navigator.storage?.estimate?.())?.usage;
  await refreshDiagnostics(false);
  render();
  syncDiagnosticsPolling();
})();

function formatBytes(value: number): string {
  if (value < 1024) return `${value} B`;
  if (value < 1024 * 1024) return `${(value / 1024).toFixed(1)} KB`;
  return `${(value / 1024 / 1024).toFixed(1)} MB`;
}
