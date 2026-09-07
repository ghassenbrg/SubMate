import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { SETTINGS_KEY } from '../../src/settings/schema';

const cache = vi.hoisted(() => ({
  cacheStats: vi.fn(async () => ({ translations: 2, sources: 1 })),
  clearCache: vi.fn(async () => undefined),
  getSource: vi.fn(),
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

beforeEach(async () => {
  vi.resetModules();
  installedListener = undefined;
  messageListener = undefined;
  stored = {};
  openOptionsPage = vi.fn(async () => undefined);
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
      },
      runtime: {
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
});
