import { afterEach, describe, expect, it, vi } from 'vitest';
import { SETTINGS_KEY } from '../../src/settings/schema';
import { loadSettings, saveSettings, watchSettings } from '../../src/settings/store';

const originalChrome = globalThis.chrome;

afterEach(() => {
  Object.defineProperty(globalThis, 'chrome', { configurable: true, writable: true, value: originalChrome });
});

function installStorageMock(initial?: unknown) {
  const values: Record<string, unknown> = initial === undefined ? {} : { [SETTINGS_KEY]: initial };
  let listener: ((changes: Record<string, chrome.storage.StorageChange>, area: string) => void) | undefined;
  const removeListener = vi.fn();
  Object.defineProperty(globalThis, 'chrome', {
    configurable: true,
    writable: true,
    value: {
      i18n: { getUILanguage: () => 'fr-FR' },
      storage: {
        local: {
          get: vi.fn(async () => ({ ...values })),
          set: vi.fn(async (update: Record<string, unknown>) => Object.assign(values, update)),
        },
        onChanged: {
          addListener: vi.fn((next: typeof listener) => { listener = next; }),
          removeListener,
        },
      },
    },
  });
  return { values, fire: (value: unknown, area = 'local') => listener?.({ [SETTINGS_KEY]: { newValue: value } }, area), removeListener };
}

describe('settings store', () => {
  it('creates validated locale-derived defaults on first load', async () => {
    const storage = installStorageMock();
    const settings = await loadSettings();
    expect(settings).toMatchObject({
      enabled: true,
      autoTranslate: true,
      preferredTargetLanguage: 'fr-FR',
      translationEngine: 'chrome-local',
      displayMode: 'bilingual',
      subtitleStylePreset: 'soft-box',
      subtitleBackground: 'soft',
      subtitleOutline: 'shadow',
      subtitleTextColor: '#ffffff',
    });
    expect(storage.values[SETTINGS_KEY]).toEqual(settings);
  });

  it('merges patches and canonicalizes language tags', async () => {
    installStorageMock({
      enabled: true,
      autoTranslate: true,
      preferredTargetLanguage: 'en-US',
      translationEngine: 'chrome-local',
      displayMode: 'bilingual',
      translatedFontScale: 1,
      verticalPosition: .13,
      showPlayerStatus: true,
      onboardingComplete: true,
      debugMode: false,
    });
    const settings = await saveSettings({ preferredTargetLanguage: 'ar_eg', translatedFontScale: 99 });
    expect(settings.preferredTargetLanguage).toBe('ar-EG');
    expect(settings.translatedFontScale).toBe(1.8);
  });

  it('validates custom subtitle appearance without allowing unsafe CSS values', async () => {
    installStorageMock({
      preferredTargetLanguage: 'fr',
      subtitleStylePreset: 'custom',
      subtitleBackground: 'none',
      subtitleOutline: 'outline',
      subtitleTextColor: 'url(javascript:alert(1))',
      translatedFontWeight: 999,
      subtitleOpacity: 0,
      subtitleLineHeight: 9,
    });
    const settings = await loadSettings();
    expect(settings).toMatchObject({
      subtitleStylePreset: 'custom',
      subtitleBackground: 'none',
      subtitleOutline: 'outline',
      subtitleTextColor: '#ffffff',
      translatedFontWeight: 800,
      subtitleOpacity: 0.5,
      subtitleLineHeight: 1.6,
    });
  });

  it('emits valid external changes and ignores malformed or unrelated writes', () => {
    const storage = installStorageMock();
    const callback = vi.fn();
    const stop = watchSettings(callback);
    storage.fire({ preferredTargetLanguage: 'ja', onboardingComplete: true });
    expect(callback).toHaveBeenCalledWith(expect.objectContaining({ preferredTargetLanguage: 'ja' }));
    storage.fire({ preferredTargetLanguage: 'not a language tag' });
    storage.fire({ preferredTargetLanguage: 'fr' }, 'sync');
    expect(callback).toHaveBeenCalledTimes(1);
    stop();
    expect(storage.removeListener).toHaveBeenCalledTimes(1);
  });
});
