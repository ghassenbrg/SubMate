import { describe, expect, it } from 'vitest';
import {
  FEATURED_LANGUAGE_CODES,
  isSuggestedLanguage,
  languageInputValue,
  parseLanguageInput,
} from '../../src/ui/shared/languages';

describe('language picker values', () => {
  it('shows a full, explicit name with the standard code', () => {
    expect(languageInputValue('ar')).toBe('Arabic (ar)');
    expect(languageInputValue('zh-Hant')).toMatch(/\(zh-Hant\)$/);
  });

  it('accepts labels, names, standard codes, and custom BCP-47 tags', () => {
    expect(parseLanguageInput('French (fr)')).toBe('fr');
    expect(parseLanguageInput('French')).toBe('fr');
    expect(parseLanguageInput('fr')).toBe('fr');
    expect(parseLanguageInput('es-MX')).toBe('es-MX');
  });

  it('features Japanese, Arabic, and French without treating suggestions as an allowlist', () => {
    expect(FEATURED_LANGUAGE_CODES).toEqual(['ja', 'ar', 'fr']);
    expect(FEATURED_LANGUAGE_CODES.every(isSuggestedLanguage)).toBe(true);
    expect(parseLanguageInput('sw-KE')).toBe('sw-KE');
  });
});
