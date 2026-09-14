import { friendlyError } from '../../shared-errors';
import { applyDocumentLocale, t } from '../../i18n';
import type { SubMateSettings } from '../../settings/schema';
import type { SubMateViewState } from '../../subtitles/models';
import { languageName } from '../shared/languages';
import { createLanguagePicker } from '../shared/language-picker';
import { getContentState, sendContent } from '../shared/messages';
import { cloudSetup } from '../../translation/cloud/readiness';
import { platformLabel } from '../../platforms';
import { statusLabel, strings } from '../shared/strings';
import { createThemeToggle, initTheme } from '../shared/theme';
import { createDisplayModeTiles } from '../shared/display-mode';
import { loadPlaybackSettings, savePlaybackSettings, saveSettingsForAllTabs } from '../shared/tab-settings';

const appNode = document.querySelector<HTMLElement>('#app');
if (!appNode) throw new Error('Popup root missing');
const app = appNode;
initTheme();
applyDocumentLocale();
let settings: SubMateSettings;
let state: SubMateViewState | undefined;
let feedback = '';
let feedbackError = false;
let cloudApiConfigured = false;
let onboardingStep = 1;
let onboardingLanguage: string | undefined;

function element<K extends keyof HTMLElementTagNameMap>(tag: K, className?: string, text?: string): HTMLElementTagNameMap[K] {
  const result = document.createElement(tag);
  if (className) result.className = className;
  if (text !== undefined) result.textContent = text;
  return result;
}

function field(label: string, control: HTMLElement): HTMLElement {
  const wrapper = element('div', 'field');
  wrapper.append(element('span', 'caption', label), control);
  return wrapper;
}

/**
 * Full-bleed heading strip that opens a group of related controls. The popup
 * is one scroll with no disclosures, so these bands carry the structure that
 * expandable sections used to imply.
 */
function band(label: string, glyph: keyof typeof ICON_PATHS): HTMLElement {
  const heading = element('div', 'group-band');
  heading.append(icon(glyph), element('span', '', label));
  return heading;
}

function group(...children: HTMLElement[]): HTMLElement {
  const body = element('div', 'group-body');
  body.append(...children);
  return body;
}

function brandIcon(className = 'brand-icon'): HTMLImageElement {
  const icon = element('img', className) as HTMLImageElement;
  // Vector, so the 84px onboarding mark stays crisp on any display density.
  icon.src = 'icons/icon.svg';
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
  captions: 'M4 5h16a1 1 0 0 1 1 1v12a1 1 0 0 1-1 1H4a1 1 0 0 1-1-1V6a1 1 0 0 1 1-1Zm3 5h3m3 0h4M7 14h4m3 0h3',
  translate: 'M12 3a9 9 0 1 0 0 18 9 9 0 0 0 0-18Zm-9 9h18M12 3c2.4 2.6 2.4 12.4 0 18M12 3c-2.4 2.6-2.4 12.4 0 18',
  files: 'M14 3H7a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V8l-5-5Zm0 0v5h5',
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

function renderOnboarding(): void {
  app.replaceChildren();
  const shell = element('section', 'shell onboarding');
  onboardingLanguage ??= settings.preferredTargetLanguage;
  const progress = element('div', 'onboarding-progress');
  progress.setAttribute('aria-label', `${onboardingStep} / 2`);
  progress.append(element('span', onboardingStep === 1 ? 'active' : ''), element('span', onboardingStep === 2 ? 'active' : ''));
  shell.append(brandIcon('onboarding-icon'), progress, element('h1', '', strings.product));
  if (onboardingStep === 1) {
    shell.append(element('p', 'muted', t('onboardingDescription')));
    const language = createLanguagePicker({
      value: onboardingLanguage,
      label: t('translateTo'),
      onCommit: (value) => { if (value) onboardingLanguage = value; },
    });
    shell.append(field(t('translateTo'), language));
    const next = element('button', 'primary wide', t('next'));
    next.addEventListener('click', () => { onboardingStep = 2; renderOnboarding(); });
    shell.append(next);
    app.append(shell);
    return;
  }
  shell.append(field(t('subtitleDisplay'), createDisplayModeTiles(settings.displayMode === 'off' ? 'bilingual' : settings.displayMode, (mode) => {
    settings = { ...settings, displayMode: mode };
    renderOnboarding();
  })));
  const privacy = element('p', 'privacy', t('privacySummary'));
  const start = element('button', 'primary wide', t('getStarted'));
  start.addEventListener('click', async () => {
    // First-run choices are the user's baseline, so every open tab adopts them.
    settings = await saveSettingsForAllTabs({ preferredTargetLanguage: onboardingLanguage ?? settings.preferredTargetLanguage, displayMode: settings.displayMode, onboardingComplete: true });
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
  const actions = element('div', 'header-actions');
  actions.append(createThemeToggle());
  header.append(actions);
  shell.append(header);

  // The popup is one playback workspace. Keeping its controls and episode
  // status together makes it clear that every choice applies to this player,
  // instead of reading like a list of unrelated settings cards.
  const workspace = element('section', 'playback-workspace');
  const card = element('section', 'episode');

  const toggleLabel = element('label', 'toggle-row');
  toggleLabel.append(element('strong', '', t('enableSubMate')));
  const toggle = element('input') as HTMLInputElement;
  toggle.type = 'checkbox'; toggle.role = 'switch'; toggle.checked = settings.enabled;
  toggle.addEventListener('change', async () => { settings = await savePlaybackSettings({ enabled: toggle.checked }); state = await getContentState(); render(); });
  toggleLabel.append(toggle);
  card.append(toggleLabel);

  const language = createLanguagePicker({ value: settings.preferredTargetLanguage, label: t('targetLanguage'), onCommit: async (value) => {
    if (!value) return;
    settings = await savePlaybackSettings({ preferredTargetLanguage: value });
    state = await getContentState(); render();
  }});

  const engine = element('select') as HTMLSelectElement;
  // Short engine names: this select shares its row with the language picker,
  // and the full "On-device · Private · Free" phrasing only fits full width.
  engine.append(
    new Option(t('onDevice'), 'chrome-local'),
    new Option(t('cloudTranslation'), 'cloud-api'),
    new Option(t('manualTranslation'), 'manual'),
  );
  engine.value = settings.translationEngine;
  engine.setAttribute('aria-label', t('engine'));
  engine.addEventListener('change', async () => {
    settings = await savePlaybackSettings({ translationEngine: engine.value as SubMateSettings['translationEngine'] });
    if (settings.translationEngine === 'cloud-api') {
      cloudApiConfigured = !(await cloudSetup(settings)).issue;
      if (!cloudApiConfigured) { feedback = t('statusCloudNotConfigured'); feedbackError = false; }
    }
    state = await getContentState(); render();
  });
  const display = createDisplayModeTiles(settings.displayMode, async (mode) => {
    settings = await savePlaybackSettings({ displayMode: mode });
    state = await getContentState(); render();
  });
  const pair = element('div', 'field-pair');
  pair.append(field(t('targetLanguage'), language), field(t('engine'), engine));
  const translationGroup = group(pair);
  if (settings.translationEngine === 'cloud-api' && !cloudApiConfigured) {
    const cloudHint = element('div', 'cloud-hint');
    cloudHint.append(element('span', '', t('statusCloudNotConfigured')));
    const configure = element('button', 'link compact-link', t('openSettings'));
    configure.type = 'button';
    configure.addEventListener('click', () => void chrome.runtime.openOptionsPage());
    cloudHint.append(configure);
    translationGroup.append(cloudHint);
  }

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
    if (state.status.state === 'target_available') {
      const chooseLanguage = element('button', 'secondary', t('chooseAnotherLanguage'));
      chooseLanguage.addEventListener('click', () => language.querySelector<HTMLButtonElement>('.language-trigger')?.click());
      card.append(chooseLanguage);
    }
  }
  workspace.append(
    card,
    band(t('subtitleDisplay'), 'captions'),
    group(display),
    band(t('translation'), 'translate'),
    translationGroup,
  );

  const format = element('select') as HTMLSelectElement;
  // Bare format names: the select sits in a three-up toolbar where the longer
  // "SubMate JSON" wording is cut off, and its accessible name says "Export format".
  format.append(new Option('JSON', 'json'), new Option('SRT', 'srt'), new Option('VTT', 'vtt'));
  format.setAttribute('aria-label', t('exportFormat'));
  const exportButton = element('button', 'secondary', t('exportAction'));
  exportButton.title = t('exportSubtitles');
  exportButton.setAttribute('aria-label', t('exportSubtitles'));
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
  const importButton = element('button', 'secondary', t('importAction'));
  importButton.title = t('importTranslation');
  importButton.setAttribute('aria-label', t('importTranslation'));
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
      feedbackError = !result; settings = await loadPlaybackSettings(); state = await getContentState(); render();
    } catch (error) {
      const code = (error as { code?: string })?.code;
      feedback = code ? friendlyError(code) : error instanceof Error ? error.message : strings.importFailed;
      feedbackError = true; render();
    }
  });
  // Both act on the active episode's track, which only exists while SubMate is
  // running; with it off they would be two permanently greyed-out buttons.
  if (settings.enabled) {
    const fileActions = element('div', 'file-actions');
    fileActions.append(format, exportButton, importButton, input);
    workspace.append(band(t('subtitleFiles'), 'files'), group(fileActions));
  }
  if (feedback) {
    const alert = element('p', feedbackError ? 'feedback error' : 'feedback success', feedback);
    alert.role = feedbackError ? 'alert' : 'status';
    workspace.append(group(alert));
  }
  if (state) {
    // Tabs are independent, so say where a change lands before it surprises.
    const hint = element('p', 'muted tab-scope-hint', t('tabScopeHint'));
    workspace.append(group(hint));
  }
  const openSettings = element('button', 'link-row', t('advancedSettings'));
  openSettings.type = 'button';
  openSettings.addEventListener('click', () => void chrome.runtime.openOptionsPage());
  workspace.append(openSettings);
  shell.append(workspace);
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
  settings = await loadPlaybackSettings();
  cloudApiConfigured = !(await cloudSetup(settings)).issue;
  state = await getContentState();
  render();
  const poll = setInterval(async () => {
    const next = await getContentState();
    if (JSON.stringify(next) === JSON.stringify(state)) return;
    state = next;
    // The player's own controls can change this tab's settings too.
    settings = await loadPlaybackSettings();
    render();
  }, 650);
  addEventListener('pagehide', () => clearInterval(poll), { once: true });
})();
