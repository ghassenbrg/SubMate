/**
 * Storage for the cloud API key.
 *
 * Deliberately kept out of `SubMateSettings`: the content script loads
 * settings on every streaming page, and a secret has no business in a
 * page-adjacent context. Only the service worker and the options page touch
 * this, and it uses `storage.local` rather than `storage.sync` so the key is
 * never replicated to the user's other devices.
 */
export const CLOUD_CREDENTIALS_KEY = 'submateCloudCredentials';

export interface CloudCredentials {
  apiKey: string;
}

const MAX_KEY_LENGTH = 400;

export async function loadCloudApiKey(): Promise<string> {
  try {
    const stored = await chrome.storage.local.get(CLOUD_CREDENTIALS_KEY);
    const value = stored[CLOUD_CREDENTIALS_KEY] as CloudCredentials | undefined;
    const key = typeof value?.apiKey === 'string' ? value.apiKey.trim() : '';
    return key.length <= MAX_KEY_LENGTH ? key : '';
  } catch {
    return '';
  }
}

export async function saveCloudApiKey(apiKey: string): Promise<void> {
  const trimmed = apiKey.trim();
  if (trimmed.length > MAX_KEY_LENGTH) throw new TypeError('API key is too long');
  if (!trimmed) {
    await chrome.storage.local.remove(CLOUD_CREDENTIALS_KEY);
    return;
  }
  await chrome.storage.local.set({ [CLOUD_CREDENTIALS_KEY]: { apiKey: trimmed } satisfies CloudCredentials });
}

export async function hasCloudApiKey(): Promise<boolean> {
  return (await loadCloudApiKey()).length > 0;
}
