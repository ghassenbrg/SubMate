import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { defaultSettings } from '../../src/settings/defaults';
import { SETTINGS_KEY, type SubMateSettings } from '../../src/settings/schema';
import type { TabSettingsRecord } from '../../src/settings/tab-scope';
import { TabSettingsScope } from '../../src/content/tab-settings';

const originalChrome = globalThis.chrome;
let stored: SubMateSettings;
let storageListener: ((changes: Record<string, chrome.storage.StorageChange>, area: string) => void) | undefined;
let worker: ReturnType<typeof vi.fn>;

const record = (revision: number, settings: Partial<TabSettingsRecord['settings']> = {}): TabSettingsRecord => ({
  revision,
  settings: { enabled: true, preferredTargetLanguage: 'fr', translationEngine: 'chrome-local', displayMode: 'bilingual', ...settings },
});

const changeGlobal = (patch: Partial<SubMateSettings>) => {
  stored = { ...stored, ...patch };
  storageListener?.({ [SETTINGS_KEY]: { newValue: stored } }, 'local');
};

beforeEach(() => {
  stored = { ...defaultSettings(), preferredTargetLanguage: 'fr' };
  storageListener = undefined;
  worker = vi.fn(async (message: { type: string; patch?: object }) => {
    if (message.type === 'TAB_SETTINGS_ATTACH') return { ok: true, value: record(1) };
    if (message.type === 'TAB_SETTINGS_UPDATE') return { ok: true, value: record(2, message.patch) };
    return { ok: false, error: 'unexpected' };
  });
  Object.defineProperty(globalThis, 'chrome', {
    configurable: true,
    writable: true,
    value: {
      i18n: { getUILanguage: () => 'en-US' },
      runtime: { sendMessage: worker },
      storage: {
        local: {
          get: vi.fn(async () => ({ [SETTINGS_KEY]: stored })),
          set: vi.fn(async (items: Record<string, SubMateSettings>) => { stored = items[SETTINGS_KEY]!; }),
        },
        onChanged: {
          addListener: (listener: typeof storageListener) => { storageListener = listener; },
          removeListener: vi.fn(),
        },
      },
    },
  });
});

afterEach(() => {
  Object.defineProperty(globalThis, 'chrome', { configurable: true, writable: true, value: originalChrome });
});

describe('content tab settings scope', () => {
  it('keeps its pinned per-tab values while other tabs change the defaults', async () => {
    const scope = new TabSettingsScope();
    await expect(scope.load()).resolves.toMatchObject({ preferredTargetLanguage: 'fr' });
    const seen: SubMateSettings[] = [];
    scope.watch((settings) => seen.push(settings));

    changeGlobal({ preferredTargetLanguage: 'ja', translatedFontScale: 1.5 });
    // Appearance is global and follows along; the language is this tab's own.
    expect(seen.at(-1)).toMatchObject({ preferredTargetLanguage: 'fr', translatedFontScale: 1.5 });
    scope.dispose();
  });

  it('applies worker broadcasts in revision order only', async () => {
    const scope = new TabSettingsScope();
    await scope.load();
    const seen: SubMateSettings[] = [];
    scope.watch((settings) => seen.push(settings));
    scope.receive(record(3, { preferredTargetLanguage: 'ar' }));
    scope.receive(record(2, { preferredTargetLanguage: 'de' }));
    scope.receive(record(3, { preferredTargetLanguage: 'de' }));
    scope.receive({ revision: 9, settings: { preferredTargetLanguage: 'x' } });
    expect(seen.map((settings) => settings.preferredTargetLanguage)).toEqual(['ar']);
  });

  it('changes only this tab unless asked to become the default', async () => {
    const scope = new TabSettingsScope();
    await scope.load();
    await scope.update({ translationEngine: 'manual' }, { asDefault: false });
    expect(stored.translationEngine).toBe('chrome-local');
    expect(worker).toHaveBeenCalledWith({ type: 'TAB_SETTINGS_UPDATE', patch: { translationEngine: 'manual' } });

    await scope.update({ displayMode: 'off' }, { asDefault: true });
    expect(stored.displayMode).toBe('off');
  });

  it('falls back to the global settings when the worker is unreachable', async () => {
    worker.mockRejectedValue(new Error('Extension context invalidated'));
    const scope = new TabSettingsScope();
    await scope.load();
    const seen: SubMateSettings[] = [];
    scope.watch((settings) => seen.push(settings));
    changeGlobal({ preferredTargetLanguage: 'ja' });
    expect(seen.at(-1)?.preferredTargetLanguage).toBe('ja');

    // A local change still sticks for this document.
    await scope.update({ displayMode: 'off' }, { asDefault: false });
    changeGlobal({ displayMode: 'bilingual' });
    expect(seen.at(-1)?.displayMode).toBe('off');
  });
});
