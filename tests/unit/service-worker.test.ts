import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { SETTINGS_KEY } from '../../src/settings/schema';
import { fakeStorageArea } from '../support/chrome-storage-area';

const cache = vi.hoisted(() => ({
  cacheStats: vi.fn(async () => ({ translations: 2, sources: 1 })),
  clearCache: vi.fn(async () => undefined),
  getSource: vi.fn(),
  getSourceForContent: vi.fn(),
  getTranslation: vi.fn(),
  putSource: vi.fn(),
  putTranslation: vi.fn(),
}));

vi.mock('../../src/cache/db', () => cache);

const originalChrome = globalThis.chrome;
let installedListener: (() => Promise<void>) | undefined;
let messageListener: ((message: unknown, sender: unknown, sendResponse: (value: unknown) => void) => boolean) | undefined;
let stored: Record<string, unknown>;
let openOptionsPage: ReturnType<typeof vi.fn>;
let tabRemovedListener: ((tabId: number) => void) | undefined;
let tabMessages: ReturnType<typeof vi.fn>;
let session: ReturnType<typeof fakeStorageArea>;

beforeEach(async () => {
  vi.resetModules();
  installedListener = undefined;
  messageListener = undefined;
  stored = {};
  openOptionsPage = vi.fn(async () => undefined);
  tabRemovedListener = undefined;
  tabMessages = vi.fn(async () => undefined);
  session = fakeStorageArea();
  Object.defineProperty(globalThis, 'chrome', {
    configurable: true,
    writable: true,
    value: {
      i18n: { getUILanguage: () => 'en-US' },
      storage: {
        local: {
          get: vi.fn(async () => ({ ...stored })),
          set: vi.fn(async (value: Record<string, unknown>) => Object.assign(stored, value)),
        },
        session,
      },
      tabs: {
        sendMessage: tabMessages,
        onRemoved: { addListener: (listener: typeof tabRemovedListener) => { tabRemovedListener = listener; } },
      },
      runtime: {
        getURL: (path: string) => `chrome-extension://submate/${path}`,
        openOptionsPage,
        onInstalled: { addListener: (listener: typeof installedListener) => { installedListener = listener; } },
        onMessage: { addListener: (listener: typeof messageListener) => { messageListener = listener; } },
      },
    },
  });
  await import('../../src/background/service-worker');
});

afterEach(() => {
  Object.defineProperty(globalThis, 'chrome', { configurable: true, writable: true, value: originalChrome });
});

describe('MV3 service worker routing', () => {
  it('initializes settings once on installation', async () => {
    await installedListener?.();
    expect(stored[SETTINGS_KEY]).toEqual(expect.objectContaining({
      preferredTargetLanguage: 'en-US',
      translationEngine: 'chrome-local',
    }));
    const first = stored[SETTINGS_KEY];
    await installedListener?.();
    expect(stored[SETTINGS_KEY]).toBe(first);
  });

  it('opens options without accepting unrelated messages', () => {
    expect(messageListener?.({ type: 'OPEN_OPTIONS' }, {}, vi.fn())).toBe(false);
    expect(openOptionsPage).toHaveBeenCalledTimes(1);
    expect(messageListener?.({ type: 'UNTRUSTED' }, {}, vi.fn())).toBe(false);
    expect(cache.cacheStats).not.toHaveBeenCalled();
  });

  it('routes bounded cache operations through an async response envelope', async () => {
    const response = vi.fn();
    expect(messageListener?.({ type: 'CACHE_STATS' }, {}, response)).toBe(true);
    await vi.waitFor(() => expect(response).toHaveBeenCalledWith({
      ok: true,
      value: { translations: 2, sources: 1 },
    }));
  });

  it('restores the last exact source for a Netflix content ID', async () => {
    cache.getSourceForContent.mockResolvedValue({ contentId: '83068200', sourceHash: 'hash' });
    const response = vi.fn();
    expect(messageListener?.({ type: 'CACHE_GET_CONTENT_SOURCE', contentId: '83068200' }, {}, response)).toBe(true);
    await vi.waitFor(() => expect(response).toHaveBeenCalledWith({
      ok: true,
      value: { contentId: '83068200', sourceHash: 'hash' },
    }));
  });
});

const EXTENSION_PAGE = { url: 'chrome-extension://submate/popup.html' };
const contentFrame = (tabId: number, documentId = `doc-${tabId}`) => ({
  url: 'https://www.netflix.com/watch/1', tab: { id: tabId }, frameId: 0, documentId,
});

async function send(message: unknown, sender: unknown) {
  const response = vi.fn();
  expect(messageListener?.(message, sender, response)).toBe(true);
  await vi.waitFor(() => expect(response).toHaveBeenCalled());
  return response.mock.calls[0]![0] as { ok: boolean; value?: unknown; error?: string };
}

describe('MV3 service worker tab independence', () => {
  it('lets a content script attach and update only its own tab', async () => {
    const attached = await send({ type: 'TAB_SETTINGS_ATTACH' }, contentFrame(5));
    expect(attached).toMatchObject({ ok: true, value: { revision: 1, settings: { preferredTargetLanguage: 'en-US' } } });
    // A tabId in the message is ignored for content scripts.
    const updated = await send({ type: 'TAB_SETTINGS_UPDATE', tabId: 9, patch: { displayMode: 'off' } }, contentFrame(5));
    expect(updated).toMatchObject({ ok: true, value: { revision: 2, settings: { displayMode: 'off' } } });
    expect(tabMessages).toHaveBeenCalledWith(5, expect.objectContaining({ type: 'CONTENT_TAB_SETTINGS' }));
    expect(session.data['tabSettings:9']).toBeUndefined();
  });

  it('lets extension pages address a tab explicitly, and nothing else reads tabs', async () => {
    const updated = await send({ type: 'TAB_SETTINGS_UPDATE', tabId: 3, patch: { preferredTargetLanguage: 'ja' } }, EXTENSION_PAGE);
    expect(updated).toMatchObject({ ok: true, value: { settings: { preferredTargetLanguage: 'ja' } } });
    await expect(send({ type: 'TAB_SETTINGS_GET', tabId: 3 }, EXTENSION_PAGE))
      .resolves.toMatchObject({ ok: true, value: { settings: { preferredTargetLanguage: 'ja' } } });
    await expect(send({ type: 'TAB_SETTINGS_GET', tabId: 3 }, contentFrame(4))).resolves.toEqual({ ok: false, error: 'Not allowed' });
    await expect(send({ type: 'TAB_SETTINGS_APPLY_DEFAULTS', keys: ['enabled'] }, contentFrame(4)))
      .resolves.toEqual({ ok: false, error: 'Not allowed' });
    await expect(send({ type: 'TAB_SETTINGS_ATTACH' }, EXTENSION_PAGE)).resolves.toEqual({ ok: false, error: 'Not allowed' });
  });

  it('rejects malformed tab settings', async () => {
    await expect(send({ type: 'TAB_SETTINGS_UPDATE', patch: { translationEngine: 'evil' } }, contentFrame(1)))
      .resolves.toMatchObject({ ok: false });
    await expect(send({ type: 'TAB_SETTINGS_UPDATE', tabId: -1, patch: {} }, EXTENSION_PAGE))
      .resolves.toMatchObject({ ok: false, error: 'Invalid tab id' });
  });

  it('applies defaults changed on the options page to every open tab', async () => {
    await send({ type: 'TAB_SETTINGS_UPDATE', patch: { preferredTargetLanguage: 'ar' } }, contentFrame(1));
    stored[SETTINGS_KEY] = { preferredTargetLanguage: 'de' };
    await expect(send({ type: 'TAB_SETTINGS_APPLY_DEFAULTS', keys: ['preferredTargetLanguage', 'cloudModel'] }, EXTENSION_PAGE))
      .resolves.toMatchObject({ ok: true });
    await expect(send({ type: 'TAB_SETTINGS_GET', tabId: 1 }, EXTENSION_PAGE))
      .resolves.toMatchObject({ value: { settings: { preferredTargetLanguage: 'de' } } });
  });

  it('coordinates translation leases between content scripts only', async () => {
    const acquire = (tabId: number, holder: string) =>
      send({ type: 'TRANSLATION_LEASE_ACQUIRE', cacheKey: 'sha256:abc', holder }, contentFrame(tabId));
    await expect(acquire(1, 'job-1')).resolves.toEqual({ ok: true, value: { granted: true } });
    await expect(send({ type: 'TRANSLATION_LEASE_RENEW', cacheKey: 'sha256:abc', holder: 'job-1', progress: { progress: 7, completedCues: 3.5 } }, contentFrame(1)))
      .resolves.toEqual({ ok: true, value: true });
    // Out-of-range progress is clamped and a fractional count dropped.
    await expect(acquire(2, 'job-2')).resolves.toEqual({ ok: true, value: { granted: false, progress: 1 } });
    await expect(send({ type: 'TRANSLATION_LEASE_STATUS', cacheKey: 'sha256:abc' }, EXTENSION_PAGE))
      .resolves.toEqual({ ok: false, error: 'Not allowed' });
    await expect(send({ type: 'TRANSLATION_LEASE_ACQUIRE', cacheKey: 'bad key!', holder: 'x' }, contentFrame(2)))
      .resolves.toEqual({ ok: false, error: 'Invalid cache key' });

    tabRemovedListener?.(1);
    await vi.waitFor(async () => expect(await send({ type: 'TRANSLATION_LEASE_STATUS', cacheKey: 'sha256:abc' }, contentFrame(2)))
      .toEqual({ ok: true, value: { held: false } }));
  });
});
