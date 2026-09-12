import type { FlixTranslateViewState } from '../../subtitles/models';

export async function activeTab(): Promise<chrome.tabs.Tab | undefined> {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  return tab;
}

/** Origins where a content script is injected, per the extension manifest. */
const SUPPORTED_ORIGINS = [
  'https://www.netflix.com/',
  'https://tver.jp/',
];

export const isSupportedTabUrl = (url: string | undefined): boolean =>
  Boolean(url) && SUPPORTED_ORIGINS.some((origin) => (url as string).startsWith(origin));

export async function sendContent<T>(message: Record<string, unknown>): Promise<T | undefined> {
  const tab = await activeTab();
  if (!tab?.id || !isSupportedTabUrl(tab.url)) return undefined;
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
