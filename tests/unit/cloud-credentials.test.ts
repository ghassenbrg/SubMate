import { beforeEach, describe, expect, it } from 'vitest';
import { CLOUD_CREDENTIALS_KEY, loadCloudApiKey, saveCloudApiKey } from '../../src/translation/cloud/credentials';

let store: Record<string, unknown> = {};

beforeEach(() => {
  store = {};
  chrome.storage.local.get = (async (key: string) => ({ [key]: store[key] })) as typeof chrome.storage.local.get;
  chrome.storage.local.set = (async (items: Record<string, unknown>) => { Object.assign(store, items); }) as typeof chrome.storage.local.set;
});

describe('cloud credentials', () => {
  it('keeps one key per provider, so switching never sends the wrong one', async () => {
    await saveCloudApiKey('gemini', 'AIza-gemini-key');
    await saveCloudApiKey('openai', 'sk-proj-openai-key');
    expect(await loadCloudApiKey('gemini')).toBe('AIza-gemini-key');
    expect(await loadCloudApiKey('openai')).toBe('sk-proj-openai-key');
    expect(await loadCloudApiKey('anthropic')).toBe('');
  });

  it('removes only the provider whose key is cleared', async () => {
    await saveCloudApiKey('gemini', 'AIza-gemini-key');
    await saveCloudApiKey('openai', 'sk-proj-openai-key');
    await saveCloudApiKey('gemini', '');
    expect(await loadCloudApiKey('gemini')).toBe('');
    expect(await loadCloudApiKey('openai')).toBe('sk-proj-openai-key');
  });

  it('reads the earlier single-key format as a Gemini key', async () => {
    store[CLOUD_CREDENTIALS_KEY] = { apiKey: 'AIza-legacy-key' };
    expect(await loadCloudApiKey('gemini')).toBe('AIza-legacy-key');
    expect(await loadCloudApiKey('openai')).toBe('');
  });
});
