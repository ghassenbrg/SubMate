import { requestWorker } from '../../core/worker-request';
import type { SubMateSettings } from '../../settings/schema';
import { loadSettings, saveSettings } from '../../settings/store';
import {
  parseTabSettingsRecord,
  tabScopedKeysIn,
  withTabSettings,
  type TabSettings,
  type TabSettingsRecord,
} from '../../settings/tab-scope';
import { supportedTab } from './messages';

async function tabRecord(tabId: number): Promise<TabSettingsRecord | undefined> {
  try {
    return parseTabSettingsRecord(await requestWorker<unknown>({ type: 'TAB_SETTINGS_GET', tabId }));
  } catch {
    return undefined;
  }
}

/** Settings as the player tab the popup is looking at actually uses them. */
export async function loadPlaybackSettings(): Promise<SubMateSettings> {
  const [global, tab] = await Promise.all([loadSettings(), supportedTab()]);
  const record = tab?.id !== undefined ? await tabRecord(tab.id) : undefined;
  return withTabSettings(global, record?.settings);
}

/**
 * Applies a change to the player tab, and makes it the default for tabs opened
 * later. Episodes playing in other tabs keep their own settings.
 */
export async function savePlaybackSettings(patch: Partial<TabSettings>): Promise<SubMateSettings> {
  const global = await saveSettings(patch);
  const tab = await supportedTab();
  if (tab?.id === undefined) return global;
  try {
    const record = parseTabSettingsRecord(
      await requestWorker<unknown>({ type: 'TAB_SETTINGS_UPDATE', tabId: tab.id, patch }),
    );
    return withTabSettings(global, record?.settings);
  } catch {
    return global;
  }
}

/** Changes the defaults and pushes the per-tab ones among them into every open tab. */
export async function saveSettingsForAllTabs(patch: Partial<SubMateSettings>): Promise<SubMateSettings> {
  const global = await saveSettings(patch);
  const keys = tabScopedKeysIn(patch);
  if (keys.length) await requestWorker({ type: 'TAB_SETTINGS_APPLY_DEFAULTS', keys }).catch(() => undefined);
  return global;
}
