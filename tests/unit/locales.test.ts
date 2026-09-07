import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { applyDocumentLocale, isRtlLocale, t } from '../../src/i18n';

const readMessages = (locale: string) => JSON.parse(readFileSync(
  resolve(process.cwd(), 'public', '_locales', locale, 'messages.json'),
  'utf8',
)) as Record<string, { message: string }>;

describe('extension localization', () => {
  it('keeps Japanese, Arabic, and French catalogs in exact key parity with English', () => {
    const englishKeys = Object.keys(readMessages('en')).sort();
    for (const locale of ['ja', 'ar', 'fr']) {
      const messages = readMessages(locale);
      expect(Object.keys(messages).sort(), locale).toEqual(englishKeys);
      expect(Object.values(messages).every(({ message }) => Boolean(message.trim())), locale).toBe(true);
    }
  });

  it('formats fallback substitutions and recognizes RTL locales', () => {
    expect(t('subtitleLines', '42')).toBe('42 subtitle lines');
    expect(isRtlLocale('ar')).toBe(true);
    expect(isRtlLocale('ar-MA')).toBe(true);
    expect(isRtlLocale('fr')).toBe(false);
  });

  it('applies locale metadata to extension documents', () => {
    applyDocumentLocale();
    expect(document.documentElement.lang).toBe('en-US');
    expect(document.documentElement.dir).toBe('ltr');
  });
});
