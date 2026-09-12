import { sendCacheMessage } from '../../cache/messages';
import { applyDocumentLocale, t } from '../../i18n';
import { loadSettings, saveSettings } from '../../settings/store';
import type { SubMateSettings } from '../../settings/schema';
import { appearanceForPreset, subtitleAppearanceVariables } from '../../settings/appearance';
import { FEATURED_LANGUAGE_CODES, isSuggestedLanguage, languageInputValue, parseLanguageInput, sortedLanguageSuggestions } from '../shared/languages';
import { sendContent } from '../shared/messages';
import { hasCloudApiKey, saveCloudApiKey } from '../../translation/cloud/credentials';
import { CLOUD_VENDORS } from '../../translation/cloud/gemini';

const appNode = document.querySelector<HTMLElement>('#app');
if (!appNode) throw new Error('Options root missing');
const app = appNode;
applyDocumentLocale();
let settings: SubMateSettings;
let stats: { translations: number; sources: number };
let storageUsage: number | undefined;
let debugInfo: Record<string, unknown> | undefined;
let appearancePreview: HTMLDivElement | undefined;

const el = <K extends keyof HTMLElementTagNameMap>(tag: K, className?: string, text?: string): HTMLElementTagNameMap[K] => {
  const node = document.createElement(tag); if (className) node.className = className; if (text !== undefined) node.textContent = text; return node;
};

const row = (label: string, control: HTMLElement, help?: string) => {
  const wrapper = el('label', 'row');
  const text = el('span'); text.append(el('strong', '', label)); if (help) text.append(el('small', '', help));
  wrapper.append(text, control); return wrapper;
};

function toggle(checked: boolean, onChange: (checked: boolean) => void): HTMLInputElement {
  const input = el('input') as HTMLInputElement; input.type = 'checkbox'; input.role = 'switch'; input.checked = checked;
  input.addEventListener('change', () => onChange(input.checked)); return input;
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

function languagePicker(value: string | undefined, allowAutomatic: boolean, onCommit: (language?: string) => void): HTMLDivElement {
  const wrapper = el('div', 'language-picker');
  const select = el('select') as HTMLSelectElement;
  const automaticValue = '__automatic__';
  const customValue = '__custom__';
  if (allowAutomatic) select.append(new Option(t('automaticLanguage'), automaticValue));
  const featured = el('optgroup') as HTMLOptGroupElement;
  featured.label = t('chooseLanguage');
  const all = sortedLanguageSuggestions();
  for (const code of FEATURED_LANGUAGE_CODES) {
    const language = all.find((item) => item.code === code);
    if (language) featured.append(new Option(language.label, language.code));
  }
  const remaining = el('optgroup') as HTMLOptGroupElement;
  remaining.label = t('targetLanguage');
  for (const language of all.filter((item) => !FEATURED_LANGUAGE_CODES.includes(item.code as (typeof FEATURED_LANGUAGE_CODES)[number]))) {
    remaining.append(new Option(language.label, language.code));
  }
  if (value && !isSuggestedLanguage(value)) remaining.prepend(new Option(languageInputValue(value), value));
  select.append(featured, remaining, new Option(t('customLanguage'), customValue));
  select.value = value ?? automaticValue;
  const custom = el('input') as HTMLInputElement;
  custom.hidden = true;
  custom.placeholder = t('customLanguagePlaceholder');
  custom.setAttribute('aria-label', t('customLanguage'));
  select.addEventListener('change', () => {
    if (select.value === customValue) {
      custom.hidden = false;
      custom.focus();
      return;
    }
    custom.hidden = true;
    onCommit(select.value === automaticValue ? undefined : select.value);
  });
  custom.addEventListener('change', () => {
    try {
      const language = parseLanguageInput(custom.value);
      custom.setCustomValidity('');
      onCommit(language);
    } catch {
      custom.setCustomValidity(t('invalidLanguage'));
      custom.reportValidity();
    }
  });
  wrapper.append(select, custom);
  return wrapper;
}

function render(): void {
  app.replaceChildren();
  const header = el('header');
  const icon = el('img', 'brand-icon') as HTMLImageElement; icon.src = 'icons/icon-48.png'; icon.alt = ''; icon.width = 48; icon.height = 48;
  header.append(icon, el('div'));
  header.lastElementChild?.append(el('h1', '', t('settingsTitle')), el('p', '', t('settingsSubtitle')));
  header.append(el('span', 'version-pill', `v${chrome.runtime.getManifest().version}`));
  app.append(header);

  const general = el('section'); general.append(el('h2', '', t('general')));
  general.append(
    row(t('enableSubMate'), toggle(settings.enabled, (enabled) => void update({ enabled }))),
    row(t('autoTranslateEpisodes'), toggle(settings.autoTranslate, (autoTranslate) => void update({ autoTranslate }))),
  );
  const target = languagePicker(settings.preferredTargetLanguage, false, (language) => { if (language) void update({ preferredTargetLanguage: language }); });
  target.firstElementChild?.setAttribute('aria-label', t('targetLanguage'));
  general.append(row(t('targetLanguage'), target, t('targetLanguageHelp')));
  const source = languagePicker(settings.preferredSourceLanguage, true, (language) => void update({ preferredSourceLanguage: language }));
  source.firstElementChild?.setAttribute('aria-label', t('preferredSourceLanguage'));
  general.append(row(t('preferredSourceLanguage'), source, t('sourceLanguageHelp')));
  app.append(general);

  const translation = el('section'); translation.append(el('h2', '', t('translation')));
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
  app.append(translation);

  const appearance = el('section'); appearance.classList.add('appearance-section'); appearance.append(el('h2', '', t('appearance')));
  const preset = el('select') as HTMLSelectElement;
  preset.dataset.stylePreset = '';
  preset.append(
    new Option(t('netflixStyle'), 'netflix'),
    new Option(t('softBoxStyle'), 'soft-box'),
    new Option(t('solidBoxStyle'), 'solid-box'),
    new Option(t('outlineStyle'), 'outline'),
    new Option(t('minimalStyle'), 'minimal'),
    new Option(t('customStyle'), 'custom'),
  );
  preset.value = settings.subtitleStylePreset;
  preset.addEventListener('change', () => {
    if (preset.value === 'custom') return;
    void update(appearanceForPreset(preset.value as Exclude<SubMateSettings['subtitleStylePreset'], 'custom'>));
  });
  const mode = el('select') as HTMLSelectElement; mode.append(new Option(t('originalAndTranslation'), 'bilingual'), new Option(t('translationOnly'), 'translation-only'), new Option(t('off'), 'off')); mode.value = settings.displayMode;
  mode.addEventListener('change', () => void update({ displayMode: mode.value as SubMateSettings['displayMode'] }));
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
  const scale = rangeControl(settings.translatedFontScale, .7, 1.8, .05, t('fontSize'), (value) => `${Math.round(value * 100)}%`, (translatedFontScale) => void update({ translatedFontScale }, false));
  const position = rangeControl(settings.verticalPosition, .04, .42, .01, t('verticalPosition'), (value) => `${Math.round(value * 100)}%`, (verticalPosition) => void update({ verticalPosition }, false));
  const opacity = rangeControl(settings.subtitleOpacity, .5, 1, .05, t('subtitleOpacity'), (value) => `${Math.round(value * 100)}%`, (subtitleOpacity) => void update({ subtitleStylePreset: 'custom', subtitleOpacity }, false));
  const lineHeight = rangeControl(settings.subtitleLineHeight, 1, 1.6, .05, t('lineSpacing'), (value) => value.toFixed(2).replace(/0$/, ''), (subtitleLineHeight) => void update({ subtitleStylePreset: 'custom', subtitleLineHeight }, false));
  const preview = el('div', 'subtitle-preview');
  preview.setAttribute('role', 'img'); preview.setAttribute('aria-label', t('stylePreview'));
  preview.append(el('span', 'preview-label', t('stylePreview')));
  const sample = el('div', 'preview-subtitle');
  sample.append(el('div', 'preview-cue preview-source', t('previewOriginal')), el('div', 'preview-cue preview-translation', t('previewTranslation')));
  preview.append(sample); appearancePreview = preview; applyAppearancePreview(preview, settings);
  appearance.append(
    preview,
    row(t('subtitleStylePreset'), preset, t('appearancePresetHelp')),
    row(t('displayMode'), mode),
    row(t('subtitleBackground'), background),
    row(t('textOutline'), outline),
    row(t('textColor'), color),
    row(t('fontWeight'), weight),
    row(t('fontSize'), scale),
    row(t('subtitleOpacity'), opacity),
    row(t('lineSpacing'), lineHeight),
    row(t('verticalPosition'), position),
    row(t('showPlayerStatus'), toggle(settings.showPlayerStatus, (showPlayerStatus) => void update({ showPlayerStatus }))),
  );
  const reset = el('button', 'secondary', t('resetAppearance')); reset.addEventListener('click', () => void update({
    displayMode: 'bilingual', translatedFontScale: 1, verticalPosition: .13, showPlayerStatus: true, ...appearanceForPreset('soft-box'),
  })); appearance.append(reset);
  app.append(appearance);

  const storage = el('section'); storage.append(el('h2', '', t('storage')), el('p', 'stat', t('cachedItems', [String(stats.translations), String(stats.sources)])));
  if (storageUsage !== undefined) storage.append(el('p', 'stat', t('extensionStorageUsed', formatBytes(storageUsage))));
  const clear = el('button', 'danger', t('clearCache')); clear.addEventListener('click', async () => {
    if (!confirm(t('clearCacheConfirm', String(stats.translations)))) return;
    await sendCacheMessage<void>({ type: 'CACHE_CLEAR' }); stats = { translations: 0, sources: 0 }; render();
  }); storage.append(clear); app.append(storage);

  const about = el('section'); about.append(el('h2', '', t('about')), el('p', '', t('version', chrome.runtime.getManifest().version)), el('p', '', t('independentNotice')), el('p', '', t('noTelemetryNotice')));
  about.append(row(t('developerDiagnostics'), toggle(settings.debugMode, (debugMode) => void update({ debugMode }))));
  if (settings.debugMode) about.append(el('pre', 'debug', JSON.stringify(debugInfo ?? { message: t('diagnosticsHint') }, null, 2)));
  app.append(about);
}

/**
 * Diagnostics are read from the player tab, which can change at any moment, so
 * they are refetched on demand rather than only once at page load. Without
 * this, switching the toggle on showed the "open an episode" hint even with an
 * episode already playing in another tab.
 */
async function refreshDiagnostics(rerender = true): Promise<void> {
  try {
    debugInfo = await sendContent<Record<string, unknown>>({ type: 'CONTENT_GET_DEBUG' });
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

  const vendor = el('select') as HTMLSelectElement;
  for (const value of Object.values(CLOUD_VENDORS)) vendor.append(new Option(value.label, value.id));
  vendor.value = settings.cloudVendor;
  vendor.addEventListener('change', () => void update({ cloudVendor: vendor.value }));
  section.append(row(t('cloudVendorLabel'), vendor));

  const keyState = el('small', 'cloud-key-state', t('cloudApiKeyMissing'));
  void hasCloudApiKey().then((present) => {
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
    void saveCloudApiKey(value).then(async () => {
      keyState.textContent = (await hasCloudApiKey()) ? t('cloudApiKeySaved') : t('cloudApiKeyMissing');
    });
  });
  section.append(row(t('cloudApiKey'), key, t('cloudApiKeyHelp')), keyState);

  const clear = el('button', 'secondary', t('cloudApiKeyClear'));
  clear.type = 'button';
  clear.addEventListener('click', () => {
    void saveCloudApiKey('').then(() => { keyState.textContent = t('cloudApiKeyMissing'); });
  });
  section.append(clear);

  const model = el('input') as HTMLInputElement;
  model.type = 'text';
  model.spellcheck = false;
  model.value = settings.cloudModel;
  model.placeholder = CLOUD_VENDORS.gemini.defaultModel;
  model.setAttribute('aria-label', t('cloudModel'));
  model.addEventListener('change', () => void update({ cloudModel: model.value.trim() }));
  section.append(row(t('cloudModel'), model, t('cloudModelHelp')));

  return section;
}

async function update(patch: Partial<SubMateSettings>, rerender = true): Promise<void> {
  const wasDebug = settings.debugMode;
  settings = await saveSettings(patch);
  syncDiagnosticsPolling();
  if (!wasDebug && settings.debugMode) {
    await refreshDiagnostics();
    return;
  }
  if (rerender) render();
  else {
    const preset = app.querySelector<HTMLSelectElement>('select[data-style-preset]');
    if (preset) preset.value = settings.subtitleStylePreset;
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
