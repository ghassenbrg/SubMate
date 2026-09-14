import type { SubMateViewState } from '../../subtitles/models';
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

export interface TabLookup {
  /**
   * Look beyond the active tab. Only for the options page: it *is* a tab, so
   * the active tab there is the options page itself and diagnostics would
   * never find a player. The popup must not use it, or a popup opened over an
   * unrelated site would report, and change, an episode in some other tab.
   */
  anyTab?: boolean;
}

/** Finds the player tab to talk to: the active tab, unless `anyTab` is set. */
export async function supportedTab({ anyTab = false }: TabLookup = {}): Promise<chrome.tabs.Tab | undefined> {
  const active = await activeTab();
  if (active?.id && isSupportedTabUrl(active.url)) return active;
  if (!anyTab) return undefined;
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

export async function sendContent<T>(message: Record<string, unknown>, lookup: TabLookup = {}): Promise<T | undefined> {
  const tab = await supportedTab(lookup);
  if (!tab?.id) return undefined;
  try {
    const response = await chrome.tabs.sendMessage(tab.id, message);
    if (!response?.ok) throw Object.assign(new Error(response?.error ?? 'SubMate request failed'), { code: response?.code });
    return response.value as T;
  } catch (error) {
    if (message.type === 'CONTENT_GET_STATE') return undefined;
    throw error;
  }
}

export const getContentState = () => sendContent<SubMateViewState>({ type: 'CONTENT_GET_STATE' });
