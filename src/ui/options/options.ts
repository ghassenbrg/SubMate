import { sendCacheMessage } from '../../cache/messages';
import { applyDocumentLocale, t } from '../../i18n';
import { loadSettings, saveSettings } from '../../settings/store';
import type { FlixTranslateSettings } from '../../settings/schema';
import { FEATURED_LANGUAGE_CODES, isSuggestedLanguage, languageInputValue, parseLanguageInput, sortedLanguageSuggestions } from '../shared/languages';
import { sendContent } from '../shared/messages';

const appNode = document.querySelector<HTMLElement>('#app');
if (!appNode) throw new Error('Options root missing');
const app = appNode;
applyDocumentLocale();
let settings: FlixTranslateSettings;
let stats: { translations: number; sources: number };
let storageUsage: number | undefined;
let debugInfo: Record<string, unknown> | undefined;

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
  app.append(header);

  const general = el('section'); general.append(el('h2', '', t('general')));
  general.append(
    row(t('enableFlixTranslate'), toggle(settings.enabled, (enabled) => void update({ enabled }))),
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
  const engine = el('select') as HTMLSelectElement; engine.append(new Option(t('onDevice'), 'chrome-local'), new Option(t('manualTranslation'), 'manual')); engine.value = settings.translationEngine;
  engine.addEventListener('change', () => void update({ translationEngine: engine.value as FlixTranslateSettings['translationEngine'] }));
  translation.append(row(t('engine'), engine, t('engineHelp')));
  app.append(translation);

  const appearance = el('section'); appearance.append(el('h2', '', t('appearance')));
  const mode = el('select') as HTMLSelectElement; mode.append(new Option(t('originalAndTranslation'), 'bilingual'), new Option(t('translationOnly'), 'translation-only'), new Option(t('off'), 'off')); mode.value = settings.displayMode;
  mode.addEventListener('change', () => void update({ displayMode: mode.value as FlixTranslateSettings['displayMode'] }));
  const scale = el('input') as HTMLInputElement; scale.type = 'range'; scale.min = '.7'; scale.max = '1.8'; scale.step = '.05'; scale.value = String(settings.translatedFontScale); scale.setAttribute('aria-label', t('fontSize')); scale.addEventListener('input', () => void update({ translatedFontScale: Number(scale.value) }, false));
  const position = el('input') as HTMLInputElement; position.type = 'range'; position.min = '.04'; position.max = '.42'; position.step = '.01'; position.value = String(settings.verticalPosition); position.setAttribute('aria-label', t('verticalPosition')); position.addEventListener('input', () => void update({ verticalPosition: Number(position.value) }, false));
  appearance.append(row(t('displayMode'), mode), row(t('fontSize'), scale), row(t('verticalPosition'), position), row(t('showPlayerStatus'), toggle(settings.showPlayerStatus, (showPlayerStatus) => void update({ showPlayerStatus }))));
  const reset = el('button', 'secondary', t('resetAppearance')); reset.addEventListener('click', () => void update({ displayMode: 'bilingual', translatedFontScale: 1, verticalPosition: .13, showPlayerStatus: true })); appearance.append(reset);
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

async function update(patch: Partial<FlixTranslateSettings>, rerender = true): Promise<void> {
  settings = await saveSettings(patch); if (rerender) render();
}

void (async () => {
  settings = await loadSettings();
  stats = await sendCacheMessage<{ translations: number; sources: number }>({ type: 'CACHE_STATS' });
  storageUsage = (await navigator.storage?.estimate?.())?.usage;
  debugInfo = await sendContent<Record<string, unknown>>({ type: 'CONTENT_GET_DEBUG' });
  render();
})();

function formatBytes(value: number): string {
  if (value < 1024) return `${value} B`;
  if (value < 1024 * 1024) return `${(value / 1024).toFixed(1)} KB`;
  return `${(value / 1024 / 1024).toFixed(1)} MB`;
}
