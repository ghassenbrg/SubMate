import { t } from '../../i18n';
import {
  FEATURED_LANGUAGE_CODES,
  isSuggestedLanguage,
  languageInputValue,
  parseLanguageInput,
  sortedLanguageSuggestions,
} from './languages';

export interface LanguagePickerOptions {
  value?: string;
  allowAutomatic?: boolean;
  label: string;
  onCommit: (language?: string) => void;
}

/**
 * A compact, keyboard-friendly language chooser. Native selects are reliable,
 * but a forty-language list is hard to scan in a small popup; search makes the
 * common action feel deliberate without hiding the full language catalogue.
 */
export function createLanguagePicker({ value, allowAutomatic = false, label, onCommit }: LanguagePickerOptions): HTMLDivElement {
  const wrapper = document.createElement('div');
  wrapper.className = 'language-picker-control';

  const trigger = document.createElement('button');
  trigger.type = 'button';
  trigger.className = 'language-trigger';
  trigger.setAttribute('aria-haspopup', 'listbox');
  trigger.setAttribute('aria-expanded', 'false');
  trigger.setAttribute('aria-label', label);

  const triggerText = document.createElement('span');
  const chevron = document.createElement('span');
  chevron.className = 'language-chevron';
  chevron.setAttribute('aria-hidden', 'true');
  chevron.textContent = '⌄';
  trigger.append(triggerText, chevron);

  const panel = document.createElement('div');
  panel.className = 'language-menu';
  panel.hidden = true;

  const search = document.createElement('input');
  search.type = 'search';
  search.className = 'language-search';
  search.placeholder = t('chooseLanguage');
  search.setAttribute('aria-label', t('chooseLanguage'));

  const choices = document.createElement('div');
  choices.className = 'language-options';
  choices.setAttribute('role', 'listbox');
  choices.setAttribute('aria-label', label);

  const custom = document.createElement('div');
  custom.className = 'language-custom';
  custom.hidden = true;
  const customInput = document.createElement('input');
  customInput.type = 'text';
  customInput.placeholder = t('customLanguagePlaceholder');
  customInput.setAttribute('aria-label', t('customLanguage'));
  const customConfirm = document.createElement('button');
  customConfirm.type = 'button';
  customConfirm.className = 'language-confirm';
  customConfirm.textContent = '✓';
  customConfirm.setAttribute('aria-label', t('targetLanguage'));
  custom.append(customInput, customConfirm);

  let current = value;
  const labelFor = (language?: string) => language ? languageInputValue(language) : t('automaticLanguage');
  const close = () => {
    panel.hidden = true;
    trigger.setAttribute('aria-expanded', 'false');
    custom.hidden = true;
    search.value = '';
  };
  const select = (language?: string) => {
    current = language;
    triggerText.textContent = labelFor(language);
    trigger.title = labelFor(language);
    close();
    onCommit(language);
  };

  const renderChoices = () => {
    const query = search.value.trim().toLocaleLowerCase();
    choices.replaceChildren();
    const addChoice = (choiceValue: string | undefined, choiceLabel: string, featured = false) => {
      if (query && !choiceLabel.toLocaleLowerCase().includes(query) && !choiceValue?.toLocaleLowerCase().includes(query)) return;
      const option = document.createElement('button');
      option.type = 'button';
      option.className = 'language-option';
      option.setAttribute('role', 'option');
      option.setAttribute('aria-selected', String(choiceValue === current));
      if (featured) option.dataset.featured = 'true';
      option.textContent = choiceLabel;
      option.addEventListener('click', () => select(choiceValue));
      choices.append(option);
    };
    if (allowAutomatic) addChoice(undefined, t('automaticLanguage'), true);
    const all = sortedLanguageSuggestions();
    for (const item of all.filter((language) => FEATURED_LANGUAGE_CODES.includes(language.code as (typeof FEATURED_LANGUAGE_CODES)[number]))) {
      addChoice(item.code, item.label, true);
    }
    for (const item of all.filter((language) => !FEATURED_LANGUAGE_CODES.includes(language.code as (typeof FEATURED_LANGUAGE_CODES)[number]))) {
      addChoice(item.code, item.label);
    }
    if (current && !isSuggestedLanguage(current)) addChoice(current, languageInputValue(current), true);
    const other = document.createElement('button');
    other.type = 'button';
    other.className = 'language-option language-other';
    other.textContent = t('customLanguage');
    other.addEventListener('click', () => {
      custom.hidden = false;
      customInput.focus();
    });
    choices.append(other);
  };
  const commitCustom = () => {
    try {
      const language = parseLanguageInput(customInput.value);
      customInput.setCustomValidity('');
      select(language);
    } catch {
      customInput.setCustomValidity(t('invalidLanguage'));
      customInput.reportValidity();
    }
  };

  triggerText.textContent = labelFor(current);
  // The trigger can ellipsise a long language name, so keep the full value on hover.
  trigger.title = labelFor(current);
  trigger.addEventListener('click', () => {
    const opening = panel.hidden;
    panel.hidden = !opening;
    trigger.setAttribute('aria-expanded', String(opening));
    if (opening) {
      renderChoices();
      search.focus();
    }
  });
  search.addEventListener('input', renderChoices);
  search.addEventListener('keydown', (event) => {
    if (event.key === 'Escape') { close(); trigger.focus(); }
  });
  customInput.addEventListener('keydown', (event) => {
    if (event.key === 'Enter') commitCustom();
    if (event.key === 'Escape') { custom.hidden = true; search.focus(); }
  });
  customConfirm.addEventListener('click', commitCustom);
  panel.append(search, choices, custom);
  wrapper.append(trigger, panel);
  return wrapper;
}
