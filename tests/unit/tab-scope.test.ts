import { describe, expect, it } from 'vitest';
import { defaultSettings } from '../../src/settings/defaults';
import {
  parseTabSettingsRecord,
  pickTabSettings,
  sanitizeTabPatch,
  tabScopedKeysIn,
  withTabSettings,
} from '../../src/settings/tab-scope';

const tab = { enabled: false, preferredTargetLanguage: 'ja', translationEngine: 'manual', displayMode: 'off' } as const;

describe('tab-scoped settings', () => {
  it('overlays only the per-tab keys on the global settings', () => {
    const global = { ...defaultSettings(), preferredTargetLanguage: 'fr', translatedFontScale: 1.4 };
    const merged = withTabSettings(global, tab);
    expect(merged).toMatchObject({ ...tab, translatedFontScale: 1.4 });
    expect(withTabSettings(global, undefined)).toBe(global);
    expect(pickTabSettings(merged)).toEqual(tab);
  });

  it('keeps valid keys, drops unknown ones and canonicalizes languages', () => {
    expect(sanitizeTabPatch({ preferredTargetLanguage: 'pt_br', cloudModel: 'x', displayMode: 'bilingual' }))
      .toEqual({ preferredTargetLanguage: 'pt-BR', displayMode: 'bilingual' });
    expect(tabScopedKeysIn({ enabled: true, theme: 'dark' })).toEqual(['enabled']);
  });

  it('rejects an invalid value instead of coercing it', () => {
    expect(() => sanitizeTabPatch({ enabled: 'yes' })).toThrow(TypeError);
    expect(() => sanitizeTabPatch({ translationEngine: 'evil' })).toThrow(TypeError);
    expect(() => sanitizeTabPatch({ displayMode: 'loud' })).toThrow(TypeError);
    expect(() => sanitizeTabPatch({ preferredTargetLanguage: '' })).toThrow(TypeError);
    expect(() => sanitizeTabPatch(null)).toThrow(TypeError);
  });

  it('accepts only complete records with a sane revision', () => {
    expect(parseTabSettingsRecord({ settings: tab, revision: 3 })).toEqual({ settings: tab, revision: 3 });
    expect(parseTabSettingsRecord({ settings: { enabled: true }, revision: 3 })).toBeUndefined();
    expect(parseTabSettingsRecord({ settings: tab, revision: -1 })).toBeUndefined();
    expect(parseTabSettingsRecord({ settings: { ...tab, displayMode: 'x' }, revision: 1 })).toBeUndefined();
    expect(parseTabSettingsRecord('nope')).toBeUndefined();
  });
});
