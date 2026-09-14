import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { defaultSettings } from '../../src/settings/defaults';
import { SETTINGS_KEY } from '../../src/settings/schema';
import { fakeStorageArea } from '../support/chrome-storage-area';

const originalChrome = globalThis.chrome;
let session: ReturnType<typeof fakeStorageArea>;
let local: ReturnType<typeof fakeStorageArea>;
let sendMessage: ReturnType<typeof vi.fn>;

beforeEach(() => {
  vi.resetModules();
  session = fakeStorageArea();
  local = fakeStorageArea({ [SETTINGS_KEY]: { ...defaultSettings(), preferredTargetLanguage: 'fr' } });
  sendMessage = vi.fn(async () => undefined);
  Object.defineProperty(globalThis, 'chrome', {
    configurable: true,
    writable: true,
    value: {
      i18n: { getUILanguage: () => 'en-US' },
      storage: { local, session },
      tabs: { sendMessage },
    },
  });
});

afterEach(() => {
  Object.defineProperty(globalThis, 'chrome', { configurable: true, writable: true, value: originalChrome });
});

const setGlobal = (patch: Record<string, unknown>) => {
  local.data[SETTINGS_KEY] = { ...(local.data[SETTINGS_KEY] as object), ...patch };
};

describe('per-tab settings authority', () => {
  it('pins the global defaults when a tab first attaches, then keeps them', async () => {
    const { attachTab } = await import('../../src/background/tab-settings');
    const first = await attachTab(7);
    expect(first).toEqual({
      settings: { enabled: true, preferredTargetLanguage: 'fr', translationEngine: 'chrome-local', displayMode: 'bilingual' },
      revision: 1,
    });
    setGlobal({ preferredTargetLanguage: 'ja' });
    // A reload or a late iframe sees what the tab pinned, not the new default.
    await expect(attachTab(7)).resolves.toEqual(first);
    await expect(attachTab(8)).resolves.toMatchObject({ settings: { preferredTargetLanguage: 'ja' } });
  });

  it('updates one tab, bumps its revision and tells only that tab', async () => {
    const { attachTab, readTab, updateTab } = await import('../../src/background/tab-settings');
    await attachTab(1);
    await attachTab(2);
    const updated = await updateTab(1, { preferredTargetLanguage: 'ar', displayMode: 'translation-only' });
    expect(updated).toMatchObject({ revision: 2, settings: { preferredTargetLanguage: 'ar', displayMode: 'translation-only' } });
    expect(sendMessage).toHaveBeenCalledTimes(1);
    expect(sendMessage).toHaveBeenCalledWith(1, { type: 'CONTENT_TAB_SETTINGS', record: updated });
    await expect(readTab(2)).resolves.toMatchObject({ revision: 1, settings: { preferredTargetLanguage: 'fr' } });
  });

  it('does not lose either of two concurrent updates to the same tab', async () => {
    const { readTab, updateTab } = await import('../../src/background/tab-settings');
    await Promise.all([updateTab(3, { enabled: false }), updateTab(3, { displayMode: 'off' })]);
    await expect(readTab(3)).resolves.toMatchObject({
      revision: 3,
      settings: { enabled: false, displayMode: 'off' },
    });
  });

  it('pushes defaults changed for all tabs into every open tab', async () => {
    const { applyDefaultsToTabs, attachTab, readTab, updateTab } = await import('../../src/background/tab-settings');
    await attachTab(1);
    await updateTab(2, { preferredTargetLanguage: 'ar', displayMode: 'off' });
    setGlobal({ preferredTargetLanguage: 'de', displayMode: 'translation-only' });
    await applyDefaultsToTabs(['preferredTargetLanguage']);
    await expect(readTab(1)).resolves.toMatchObject({ settings: { preferredTargetLanguage: 'de', displayMode: 'bilingual' } });
    // Keys that were not changed keep each tab's own choice.
    await expect(readTab(2)).resolves.toMatchObject({ settings: { preferredTargetLanguage: 'de', displayMode: 'off' } });
  });

  it('forgets a closed tab and survives a broadcast with no receiver', async () => {
    sendMessage.mockRejectedValue(new Error('Receiving end does not exist'));
    const { forgetTab, readTab, updateTab } = await import('../../src/background/tab-settings');
    await expect(updateTab(4, { enabled: false })).resolves.toMatchObject({ revision: 2 });
    await forgetTab(4);
    await expect(readTab(4)).resolves.toBeUndefined();
  });
});
