import { friendlyError } from '../../shared-errors';
import { applyDocumentLocale, t } from '../../i18n';
import { loadSettings, saveSettings } from '../../settings/store';
import type { SubMateSettings } from '../../settings/schema';
import type { SubMateViewState } from '../../subtitles/models';
import { FEATURED_LANGUAGE_CODES, isSuggestedLanguage, languageInputValue, languageName, parseLanguageInput, sortedLanguageSuggestions } from '../shared/languages';
import { getContentState, sendContent } from '../shared/messages';
import { platformLabel } from '../../platforms';
import { statusLabel, strings } from '../shared/strings';

const appNode = document.querySelector<HTMLElement>('#app');
if (!appNode) throw new Error('Popup root missing');
const app = appNode;
applyDocumentLocale();
let settings: SubMateSettings;
let state: SubMateViewState | undefined;
let feedback = '';
let feedbackError = false;

function element<K extends keyof HTMLElementTagNameMap>(tag: K, className?: string, text?: string): HTMLElementTagNameMap[K] {
  const result = document.createElement(tag);
  if (className) result.className = className;
  if (text !== undefined) result.textContent = text;
  return result;
}

function field(label: string, control: HTMLElement): HTMLElement {
  const wrapper = element('label', 'field');
  wrapper.append(element('span', 'eyebrow', label), control);
  return wrapper;
}

function brandIcon(className = 'brand-icon'): HTMLImageElement {
  const icon = element('img', className) as HTMLImageElement;
  icon.src = 'icons/icon-48.png';
  icon.alt = '';
  icon.width = 40;
  icon.height = 40;
  return icon;
}

/**
 * Inline stroke icons. Kept as path data rather than image files so the popup
 * needs no extra network round trip and the glyphs inherit currentColor.
 */
const ICON_PATHS = {
  export: 'M12 3v12m-4-4 4 4 4-4M4 20h16',
  import: 'M12 21V9m-4 4 4-4 4 4M4 4h16',
  sliders: 'M4 7h5m4 0h7M4 17h11m4 0h1M11 4.5v5M17 14.5v5',
  star: 'm12 3.6 2.6 5.3 5.8.8-4.2 4.1 1 5.8-5.2-2.7-5.2 2.7 1-5.8-4.2-4.1 5.8-.8z',
} as const;

function icon(name: keyof typeof ICON_PATHS): SVGSVGElement {
  const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  svg.setAttribute('class', 'icon');
  svg.setAttribute('viewBox', '0 0 24 24');
  svg.setAttribute('fill', 'none');
  svg.setAttribute('aria-hidden', 'true');
  const path = document.createElementNS('http://www.w3.org/2000/svg', 'path');
  path.setAttribute('d', ICON_PATHS[name]);
  path.setAttribute('stroke', 'currentColor');
  path.setAttribute('stroke-width', '2');
  path.setAttribute('stroke-linecap', 'round');
  path.setAttribute('stroke-linejoin', 'round');
  svg.append(path);
  return svg;
}

function languageControl(value: string, onCommit: (language: string) => void): HTMLDivElement {
  const wrapper = element('div', 'language-control');
  const select = element('select', 'selectlike language-select') as HTMLSelectElement;
  select.setAttribute('aria-label', t('targetLanguage'));
  const featured = element('optgroup') as HTMLOptGroupElement;
  featured.label = t('chooseLanguage');
  const all = sortedLanguageSuggestions();
  for (const code of FEATURED_LANGUAGE_CODES) {
    const language = all.find((item) => item.code === code);
    if (language) featured.append(new Option(language.label, language.code));
  }
  const remaining = element('optgroup') as HTMLOptGroupElement;
  remaining.label = t('targetLanguage');
  for (const language of all.filter((item) => !FEATURED_LANGUAGE_CODES.includes(item.code as (typeof FEATURED_LANGUAGE_CODES)[number]))) {
    remaining.append(new Option(language.label, language.code));
  }
  if (!isSuggestedLanguage(value)) remaining.prepend(new Option(languageInputValue(value), value));
  select.append(featured, remaining, new Option(t('customLanguage'), '__custom__'));
  select.value = value;
  const custom = element('input', 'custom-language') as HTMLInputElement;
  custom.placeholder = t('customLanguagePlaceholder');
  custom.setAttribute('aria-label', t('customLanguage'));
  custom.hidden = true;
  const name = element('small', 'language-name', t('selectedLanguage', languageName(value)));
  const commitCustom = () => {
    try {
      const language = parseLanguageInput(custom.value);
      custom.setCustomValidity('');
      onCommit(language);
    }
    catch { custom.setCustomValidity(t('invalidLanguage')); custom.reportValidity(); }
  };
  select.addEventListener('change', () => {
    if (select.value === '__custom__') {
      custom.hidden = false;
      custom.focus();
      return;
    }
    custom.hidden = true;
    onCommit(select.value);
  });
  custom.addEventListener('change', commitCustom);
  wrapper.append(select, custom, name);
  return wrapper;
}

function renderOnboarding(): void {
  app.replaceChildren();
  const shell = element('section', 'shell onboarding');
  shell.append(brandIcon('onboarding-icon'), element('h1', '', strings.product), element('p', 'muted', t('onboardingDescription')));
  let selected = settings.preferredTargetLanguage;
  const language = languageControl(selected, (value) => { selected = value; });
  shell.append(field(t('translateTo').toUpperCase(), language));
  const display = element('select', 'selectlike') as HTMLSelectElement;
  display.append(new Option(t('originalAndTranslation'), 'bilingual'), new Option(t('translationOnly'), 'translation-only'));
  display.value = settings.displayMode === 'off' ? 'bilingual' : settings.displayMode;
  shell.append(field(t('subtitleDisplay').toUpperCase(), display));
  const privacy = element('p', 'privacy', t('privacySummary'));
  const start = element('button', 'primary wide', t('getStarted'));
  start.addEventListener('click', async () => {
    settings = await saveSettings({ preferredTargetLanguage: selected, displayMode: display.value as SubMateSettings['displayMode'], onboardingComplete: true });
    state = await getContentState();
    render();
  });
  shell.append(privacy, start);
  app.append(shell);
}

function render(): void {
  if (!settings.onboardingComplete) return renderOnboarding();
  app.replaceChildren();
  const shell = element('section', 'shell');
  const header = element('header');
  header.append(brandIcon());
  const titles = element('div');
  titles.append(element('h1', '', strings.product), element('p', 'tagline', strings.tagline));
  header.append(titles);
  if (state?.contentDetected) {
    const label = state.platform ? platformLabel(state.platform) : 'Netflix';
    header.append(element('span', 'detected pill', t('platformDetected', label)));
  }
  shell.append(header);

  const toggleLabel = element('label', 'toggle-row');
  toggleLabel.append(element('span', '', t('enableSubMate')));
  const toggle = element('input') as HTMLInputElement;
  toggle.type = 'checkbox'; toggle.role = 'switch'; toggle.checked = settings.enabled;
  toggle.addEventListener('change', async () => { settings = await saveSettings({ enabled: toggle.checked }); state = await getContentState(); render(); });
  toggleLabel.append(toggle);
  shell.append(toggleLabel);

  const language = languageControl(settings.preferredTargetLanguage, async (value) => {
    settings = await saveSettings({ preferredTargetLanguage: value });
    state = await getContentState(); render();
  });
  const controls = element('section', 'controls');
  controls.append(field(t('targetLanguage').toUpperCase(), language));

  const engine = element('select', 'selectlike') as HTMLSelectElement;
  engine.append(
    new Option(t('onDevicePrivateFree'), 'chrome-local'),
    new Option(t('manualTranslation'), 'manual'),
  );
  engine.value = settings.translationEngine;
  engine.addEventListener('change', async () => { settings = await saveSettings({ translationEngine: engine.value as SubMateSettings['translationEngine'] }); state = await getContentState(); render(); });
  controls.append(field(t('translation').toUpperCase(), engine));

  const display = element('select', 'selectlike') as HTMLSelectElement;
  display.append(new Option(t('originalAndTranslation'), 'bilingual'), new Option(t('translationOnly'), 'translation-only'), new Option(t('off'), 'off'));
  display.value = settings.displayMode;
  display.addEventListener('change', async () => { settings = await saveSettings({ displayMode: display.value as SubMateSettings['displayMode'] }); });
  controls.append(field(t('display').toUpperCase(), display));

  const card = element('section', 'episode');
  card.append(element('div', 'eyebrow', t('currentEpisode').toUpperCase()));
  if (!state) {
    card.append(element('p', 'empty', strings.notNetflix));
  } else if (!state.hasPlayer) {
    card.append(element('p', 'empty', strings.noPlayer));
  } else {
    const pair = state.sourceLanguage
      ? `${state.sourceLanguageLabel ?? languageName(state.sourceLanguage)} → ${state.targetLanguageLabel}`
      : t('sourceSubtitleToTarget', state.targetLanguageLabel);
    card.append(element('h2', 'pair', pair));
    const status = element('p', `status state-${state.status.state}`, statusLabel(state.status));
    status.setAttribute('aria-live', 'polite');
    card.append(status);
    if (state.status.progress !== undefined && ['translating', 'downloading_model'].includes(state.status.state)) {
      const progress = element('progress') as HTMLProgressElement;
      progress.max = 1; progress.value = state.status.progress; progress.setAttribute('aria-label', t('translationProgress'));
      card.append(progress);
      if (state.status.totalCues) card.append(element('small', 'muted', t('progressLines', [String(state.status.completedCues ?? 0), String(state.status.totalCues)])));
    } else if (state.sourceCueCount) card.append(element('small', 'muted', t('subtitleLines', String(state.sourceCueCount))));
    if (state.status.state === 'needs_user_activation' && settings.translationEngine === 'chrome-local') {
      const activate = element('button', 'primary', t('startTranslation'));
      activate.addEventListener('click', async () => { await sendContent({ type: 'CONTENT_ACTIVATE' }); state = await getContentState(); render(); });
      card.append(activate);
    }
    if (state.status.state === 'failed') {
      const retry = element('button', 'primary', t('retry'));
      retry.addEventListener('click', async () => { await sendContent({ type: 'CONTENT_RETRY' }); state = await getContentState(); render(); });
      card.append(retry);
    }
  }
  shell.append(card, controls);

  const tools = element('section', 'tools');
  const format = element('select', 'compact') as HTMLSelectElement;
  format.append(new Option(t('subMateJson'), 'json'), new Option('SRT', 'srt'), new Option('VTT', 'vtt'));
  format.setAttribute('aria-label', t('exportFormat'));
  const exportButton = element('button', 'secondary', t('exportSubtitles'));
  exportButton.prepend(icon('export'));
  exportButton.disabled = !state?.sourceCueCount;
  exportButton.addEventListener('click', async () => {
    try {
      const file = await sendContent<{ content: string; fileName: string; mimeType: string }>({ type: 'CONTENT_EXPORT', format: format.value });
      if (!file) throw new Error(t('noActiveSubtitle'));
      const url = URL.createObjectURL(new Blob([file.content], { type: file.mimeType }));
      const link = document.createElement('a'); link.href = url; link.download = file.fileName; link.click();
      setTimeout(() => URL.revokeObjectURL(url), 1000);
      feedback = t('sourceExported'); feedbackError = false; render();
    } catch (error) { feedback = error instanceof Error ? error.message : String(error); feedbackError = true; render(); }
  });
  const importButton = element('button', 'secondary', t('importTranslation'));
  importButton.prepend(icon('import'));
  importButton.disabled = !state?.sourceCueCount;
  const input = element('input') as HTMLInputElement;
  input.type = 'file'; input.accept = '.json,.srt,.vtt,application/json,text/vtt'; input.hidden = true;
  importButton.addEventListener('click', () => input.click());
  input.addEventListener('change', async () => {
    const file = input.files?.[0]; if (!file) return;
    try {
      if (file.size > 10_000_000) throw new Error(t('fileTooLarge'));
      const result = await sendContent<{ matched: number; total: number; untranslated: number; targetLanguage: string }>({ type: 'CONTENT_IMPORT', content: await file.text(), fileName: file.name });
      feedback = result
        ? [
            t('importMatched', [strings.importReady, String(result.matched), String(result.total)]),
            result.untranslated ? t('importUntranslated', String(result.untranslated)) : '',
          ].filter(Boolean).join(' ')
        : strings.importFailed;
      feedbackError = !result; settings = await loadSettings(); state = await getContentState(); render();
    } catch (error) {
      const code = (error as { code?: string })?.code;
      feedback = code ? friendlyError(code) : error instanceof Error ? error.message : strings.importFailed;
      feedbackError = true; render();
    }
  });
  tools.append(format, exportButton, importButton, input);
  shell.append(tools);
  if (feedback) { const alert = element('p', feedbackError ? 'feedback error' : 'feedback success', feedback); alert.role = feedbackError ? 'alert' : 'status'; shell.append(alert); }
  const advanced = element('button', 'link', t('advancedSettings'));
  advanced.prepend(icon('sliders'));
  advanced.addEventListener('click', () => void chrome.runtime.openOptionsPage());
  shell.append(advanced);
  const footer = element('footer', 'popup-footer');
  footer.append(element('span', 'version', `v${chrome.runtime.getManifest().version}`));
  footer.append(element('span', 'footer-divider', '|'));
  const github = element('a', 'github-link');
  github.href = 'https://github.com/ghassenbrg/SubMate';
  github.target = '_blank';
  github.rel = 'noopener noreferrer';
  github.setAttribute('aria-label', t('starAria'));
  github.append(icon('star'), t('starOnGitHub'), element('strong', '', 'GitHub'));
  footer.append(github);
  shell.append(footer);
  app.append(shell);
}

void (async () => {
  settings = await loadSettings();
  state = await getContentState();
  render();
  const poll = setInterval(async () => {
    const next = await getContentState();
    if (JSON.stringify(next) !== JSON.stringify(state)) { state = next; render(); }
  }, 650);
  addEventListener('pagehide', () => clearInterval(poll), { once: true });
})();
