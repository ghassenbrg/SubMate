import { defaultSettings } from './defaults';
import { SETTINGS_KEY, validateSettings, type FlixTranslateSettings } from './schema';

const hasChromeStorage = () => typeof chrome !== 'undefined' && Boolean(chrome.storage?.local);

export async function loadSettings(): Promise<FlixTranslateSettings> {
  if (!hasChromeStorage()) return defaultSettings();
  const stored = await chrome.storage.local.get(SETTINGS_KEY);
  if (!stored[SETTINGS_KEY]) {
    const initial = defaultSettings();
    await chrome.storage.local.set({ [SETTINGS_KEY]: initial });
    return initial;
  }
  try {
    return validateSettings(stored[SETTINGS_KEY]);
  } catch {
    const initial = defaultSettings();
    await chrome.storage.local.set({ [SETTINGS_KEY]: initial });
    return initial;
  }
}

export async function saveSettings(
  patch: Partial<FlixTranslateSettings>,
): Promise<FlixTranslateSettings> {
  const next = validateSettings({ ...(await loadSettings()), ...patch });
  if (hasChromeStorage()) await chrome.storage.local.set({ [SETTINGS_KEY]: next });
  return next;
}

export function watchSettings(callback: (settings: FlixTranslateSettings) => void): () => void {
  if (!hasChromeStorage()) return () => undefined;
  const listener = (changes: Record<string, chrome.storage.StorageChange>, area: string) => {
    if (area !== 'local' || !changes[SETTINGS_KEY]?.newValue) return;
    try {
      callback(validateSettings(changes[SETTINGS_KEY].newValue));
    } catch {
      // Ignore malformed writes from other extensions/devtools.
    }
  };
  chrome.storage.onChanged.addListener(listener);
  return () => chrome.storage.onChanged.removeListener(listener);
}
