import type { FlixTranslateViewState } from '../../subtitles/models';

export async function activeTab(): Promise<chrome.tabs.Tab | undefined> {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  return tab;
}

export async function sendContent<T>(message: Record<string, unknown>): Promise<T | undefined> {
  const tab = await activeTab();
  if (!tab?.id || !tab.url?.startsWith('https://www.netflix.com/')) return undefined;
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
