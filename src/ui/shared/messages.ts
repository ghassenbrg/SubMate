import type { FlixTranslateViewState } from '../../subtitles/models';
import { selectAdapter } from '../../platforms';

/**
 * Tab patterns matching the content-script declarations in the manifest.
 * Used only to narrow the query; membership is then confirmed by the adapter
 * registry so this list cannot silently disagree with it.
 */
const SUPPORTED_TAB_PATTERNS = [
  'https://www.netflix.com/*',
  'https://tver.jp/*',
  'https://*.tver.jp/*',
  'https://*.primevideo.com/*',
  'https://www.amazon.co.jp/gp/video/*',
  'https://www.amazon.com/gp/video/*',
];

/**
 * True when a tab runs one of our content scripts.
 *
 * The adapter registry is the single source of truth, so a newly supported
 * platform becomes visible to the UI without a second list to update.
 */
export const isSupportedTabUrl = (url: string | undefined): boolean => {
  if (!url) return false;
  try {
    return Boolean(selectAdapter(new URL(url)));
  } catch {
    return false;
  }
};

export async function activeTab(): Promise<chrome.tabs.Tab | undefined> {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  return tab;
}

/**
 * Finds the tab to talk to.
 *
 * The popup leaves the player tab active, but the options page *is* a tab, so
 * asking for the active tab there returns the options page itself and every
 * request silently resolves to undefined. Falling back to a query across
 * supported tabs is what lets diagnostics work from the options page at all.
 */
export async function supportedTab(): Promise<chrome.tabs.Tab | undefined> {
  const active = await activeTab();
  if (active?.id && isSupportedTabUrl(active.url)) return active;
  let candidates: chrome.tabs.Tab[] = [];
  try {
    candidates = await chrome.tabs.query({ url: SUPPORTED_TAB_PATTERNS });
  } catch {
    return undefined;
  }
  const usable = candidates.filter((tab) => tab.id && isSupportedTabUrl(tab.url));
  // Prefer whatever the user is most plausibly watching.
  return usable.find((tab) => tab.active)
    ?? usable.find((tab) => tab.audible)
    ?? usable.at(-1);
}

export async function sendContent<T>(message: Record<string, unknown>): Promise<T | undefined> {
  const tab = await supportedTab();
  if (!tab?.id) return undefined;
  try {
    const response = await chrome.tabs.sendMessage(tab.id, message);
    if (!response?.ok) throw Object.assign(new Error(response?.error ?? 'FlixTranslate request failed'), { code: response?.code });
    return response.value as T;
  } catch (error) {
    if (message.type === 'CONTENT_GET_STATE') return undefined;
    throw error;
  }
}

export const getContentState = () => sendContent<FlixTranslateViewState>({ type: 'CONTENT_GET_STATE' });
