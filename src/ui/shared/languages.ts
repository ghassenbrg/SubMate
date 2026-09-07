import { canonicalLanguage } from '../../settings/schema';
import { uiLocale } from '../../i18n';

// Suggestions are not a capability allowlist: any valid BCP-47 tag may be entered.
// Keep names explicit so the picker never makes people decode a two-letter code.
export const LANGUAGE_SUGGESTIONS = [
  { code: 'ar', name: 'Arabic' },
  { code: 'bn', name: 'Bengali' },
  { code: 'bg', name: 'Bulgarian' },
  { code: 'zh', name: 'Chinese (Simplified)' },
  { code: 'zh-Hant', name: 'Chinese (Traditional)' },
  { code: 'hr', name: 'Croatian' },
  { code: 'cs', name: 'Czech' },
  { code: 'da', name: 'Danish' },
  { code: 'nl', name: 'Dutch' },
  { code: 'en', name: 'English' },
  { code: 'en-GB', name: 'English (United Kingdom)' },
  { code: 'en-US', name: 'English (United States)' },
  { code: 'fi', name: 'Finnish' },
  { code: 'fr', name: 'French' },
  { code: 'de', name: 'German' },
  { code: 'el', name: 'Greek' },
  { code: 'he', name: 'Hebrew' },
  { code: 'hi', name: 'Hindi' },
  { code: 'hu', name: 'Hungarian' },
  { code: 'id', name: 'Indonesian' },
  { code: 'it', name: 'Italian' },
  { code: 'ja', name: 'Japanese' },
  { code: 'kn', name: 'Kannada' },
  { code: 'ko', name: 'Korean' },
  { code: 'lt', name: 'Lithuanian' },
  { code: 'mr', name: 'Marathi' },
  { code: 'no', name: 'Norwegian' },
  { code: 'pl', name: 'Polish' },
  { code: 'pt', name: 'Portuguese' },
  { code: 'ro', name: 'Romanian' },
  { code: 'ru', name: 'Russian' },
  { code: 'sk', name: 'Slovak' },
  { code: 'sl', name: 'Slovenian' },
  { code: 'es', name: 'Spanish' },
  { code: 'sv', name: 'Swedish' },
  { code: 'ta', name: 'Tamil' },
  { code: 'te', name: 'Telugu' },
  { code: 'th', name: 'Thai' },
  { code: 'tr', name: 'Turkish' },
  { code: 'uk', name: 'Ukrainian' },
  { code: 'vi', name: 'Vietnamese' },
] as const;

export const FEATURED_LANGUAGE_CODES = ['ja', 'ar', 'fr'] as const;

export function isSuggestedLanguage(tag: string): boolean {
  return LANGUAGE_SUGGESTIONS.some(({ code }) => code.toLowerCase() === tag.toLowerCase());
}

export function sortedLanguageSuggestions(): Array<{ code: string; label: string }> {
  const collator = new Intl.Collator(uiLocale(), { sensitivity: 'base' });
  return LANGUAGE_SUGGESTIONS
    .map(({ code }) => ({ code, label: languageInputValue(code) }))
    .sort((a, b) => collator.compare(a.label, b.label));
}

export function languageName(tag: string): string {
  try { return new Intl.DisplayNames([uiLocale()], { type: 'language' }).of(tag) ?? tag; }
  catch {
    return LANGUAGE_SUGGESTIONS.find(({ code }) => code.toLowerCase() === tag.toLowerCase())?.name ?? tag;
  }
}

export function languageInputValue(tag: string): string {
  const canonical = canonicalLanguage(tag);
  return `${languageName(canonical)} (${canonical})`;
}

export function parseLanguageInput(value: string): string {
  const trimmed = value.trim();
  const labelledCode = trimmed.match(/\(([^()]+)\)\s*$/)?.[1];
  if (labelledCode) return canonicalLanguage(labelledCode);
  const named = LANGUAGE_SUGGESTIONS.find(({ name }) => name.toLowerCase() === trimmed.toLowerCase());
  return canonicalLanguage(named?.code ?? trimmed);
}
