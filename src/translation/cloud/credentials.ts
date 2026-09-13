/**
 * Storage for cloud API keys, one per provider.
 *
 * Deliberately kept out of `SubMateSettings`: the content script loads
 * settings on every streaming page, and a secret has no business in a
 * page-adjacent context. Only the service worker and the options page touch
 * this, and it uses `storage.local` rather than `storage.sync` so keys are
 * never replicated to the user's other devices.
 *
 * Keys are stored per provider so switching providers never sends one
 * provider's key to another's endpoint.
 */
export const CLOUD_CREDENTIALS_KEY = 'submateCloudCredentials';

export interface CloudCredentials {
  keys: Record<string, string>;
}

const MAX_KEY_LENGTH = 400;

async function loadAll(): Promise<Record<string, string>> {
  try {
    const stored = await chrome.storage.local.get(CLOUD_CREDENTIALS_KEY);
    const value = stored[CLOUD_CREDENTIALS_KEY] as Partial<CloudCredentials> & { apiKey?: unknown } | undefined;
    const keys: Record<string, string> = {};
    for (const [provider, key] of Object.entries(value?.keys ?? {})) {
      if (typeof key === 'string') keys[provider] = key;
    }
    // Before keys were per provider there was a single Gemini key.
    if (typeof value?.apiKey === 'string' && !keys.gemini) keys.gemini = value.apiKey;
    return keys;
  } catch {
    return {};
  }
}

export async function loadCloudApiKey(provider: string): Promise<string> {
  const key = ((await loadAll())[provider] ?? '').trim();
  return key.length <= MAX_KEY_LENGTH ? key : '';
}

export async function saveCloudApiKey(provider: string, apiKey: string): Promise<void> {
  const trimmed = apiKey.trim();
  if (trimmed.length > MAX_KEY_LENGTH) throw new TypeError('API key is too long');
  const keys = await loadAll();
  if (trimmed) keys[provider] = trimmed;
  else delete keys[provider];
  await chrome.storage.local.set({ [CLOUD_CREDENTIALS_KEY]: { keys } satisfies CloudCredentials });
}

export async function hasCloudApiKey(provider: string): Promise<boolean> {
  return (await loadCloudApiKey(provider)).length > 0;
}
