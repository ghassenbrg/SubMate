import { createKeyedQueue } from '../core/concurrency';
import { loadSettings } from '../settings/store';
import {
  parseTabSettingsRecord,
  pickTabSettings,
  type TabScopedKey,
  type TabSettings,
  type TabSettingsRecord,
} from '../settings/tab-scope';

/**
 * The authority for per-tab settings.
 *
 * Records live in `storage.session`: they survive a worker shutdown and a page
 * reload, and every frame of a tab sees the same values, but they are gone when
 * the browser closes. Content scripts cannot read session storage themselves,
 * so they attach through messages and are told about changes by broadcast.
 */
const PREFIX = 'tabSettings:';
const storageKey = (tabId: number) => `${PREFIX}${tabId}`;
const serialized = createKeyedQueue();

export interface TabSettingsBroadcast {
  type: 'CONTENT_TAB_SETTINGS';
  record: TabSettingsRecord;
}

async function read(tabId: number): Promise<TabSettingsRecord | undefined> {
  const key = storageKey(tabId);
  const stored = await chrome.storage.session.get(key);
  return parseTabSettingsRecord(stored[key]);
}

async function write(tabId: number, record: TabSettingsRecord): Promise<void> {
  await chrome.storage.session.set({ [storageKey(tabId)]: record });
  const message: TabSettingsBroadcast = { type: 'CONTENT_TAB_SETTINGS', record };
  // Every frame of the tab hears it; a tab without our content script (or one
  // mid-navigation) simply has no receiver. Not awaited: a slow frame must not
  // hold up the next write, and the revision keeps late deliveries harmless.
  void chrome.tabs.sendMessage(tabId, message).catch(() => undefined);
}

/** The current record, created from the global defaults on first use. */
async function ensure(tabId: number): Promise<TabSettingsRecord> {
  const existing = await read(tabId);
  if (existing) return existing;
  const record: TabSettingsRecord = { settings: pickTabSettings(await loadSettings()), revision: 1 };
  await chrome.storage.session.set({ [storageKey(tabId)]: record });
  return record;
}

export const attachTab = (tabId: number): Promise<TabSettingsRecord> =>
  serialized(storageKey(tabId), () => ensure(tabId));

export const readTab = (tabId: number): Promise<TabSettingsRecord | undefined> =>
  serialized(storageKey(tabId), () => read(tabId));

export const updateTab = (tabId: number, patch: Partial<TabSettings>): Promise<TabSettingsRecord> =>
  serialized(storageKey(tabId), async () => {
    const current = await ensure(tabId);
    const next: TabSettingsRecord = {
      settings: { ...current.settings, ...patch },
      revision: current.revision + 1,
    };
    await write(tabId, next);
    return next;
  });

/**
 * Pushes the global value of `keys` into every open tab. Used when a default
 * is changed from a place that speaks for all tabs, such as the options page.
 */
export async function applyDefaultsToTabs(keys: readonly TabScopedKey[]): Promise<void> {
  if (!keys.length) return;
  const defaults = pickTabSettings(await loadSettings());
  const patch: Partial<TabSettings> = Object.fromEntries(keys.map((key) => [key, defaults[key]]));
  const stored = await chrome.storage.session.get(null);
  const tabIds = Object.keys(stored)
    .filter((key) => key.startsWith(PREFIX))
    .map((key) => Number(key.slice(PREFIX.length)))
    .filter((tabId) => Number.isInteger(tabId));
  await Promise.all(tabIds.map((tabId) => updateTab(tabId, patch)));
}

export const forgetTab = (tabId: number): Promise<void> =>
  serialized(storageKey(tabId), () => chrome.storage.session.remove(storageKey(tabId)));
