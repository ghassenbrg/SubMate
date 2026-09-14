import { afterEach, describe, expect, it, vi } from 'vitest';
import { isSupportedTabUrl, sendContent, supportedTab } from '../../src/ui/shared/messages';

type Tab = Partial<chrome.tabs.Tab>;

function stubTabs(options: { active?: Tab; all?: Tab[]; onSend?: (id: number, message: unknown) => unknown }) {
  const query = vi.fn(async (info: chrome.tabs.QueryInfo) =>
    (info.active ? (options.active ? [options.active] : []) : (options.all ?? [])) as chrome.tabs.Tab[]);
  const sendMessage = vi.fn(async (id: number, message: unknown) =>
    options.onSend ? options.onSend(id, message) : { ok: true, value: { ok: true } });
  (globalThis as unknown as { chrome: Record<string, unknown> }).chrome = {
    ...(globalThis as unknown as { chrome: Record<string, unknown> }).chrome,
    tabs: { query, sendMessage },
  };
  return { query, sendMessage };
}

afterEach(() => vi.restoreAllMocks());

describe('supported tab detection', () => {
  it('recognises every registered platform, and nothing else', () => {
    expect(isSupportedTabUrl('https://www.netflix.com/watch/1')).toBe(true);
    expect(isSupportedTabUrl('https://tver.jp/episodes/abc')).toBe(true);
    expect(isSupportedTabUrl('https://www.primevideo.com/detail/B0ABCD1234')).toBe(true);
    expect(isSupportedTabUrl('https://www.amazon.co.jp/gp/video/detail/B0ABCD1234')).toBe(true);
    expect(isSupportedTabUrl('https://www.amazon.co.jp/gp/cart/view.html')).toBe(false);
    expect(isSupportedTabUrl('chrome-extension://abc/options.html')).toBe(false);
    expect(isSupportedTabUrl(undefined)).toBe(false);
  });

  it('uses the active tab when it is already a player', async () => {
    stubTabs({ active: { id: 7, url: 'https://tver.jp/episodes/abc', active: true } });
    expect((await supportedTab())?.id).toBe(7);
  });

  it('finds the player tab when the options page is the active one', async () => {
    // Regression: the options page is itself a tab, so asking for the active
    // tab returned the options page and diagnostics silently showed the
    // "open a supported episode" hint with an episode already playing.
    stubTabs({
      active: { id: 1, url: 'chrome-extension://abc/options.html', active: true },
      all: [{ id: 9, url: 'https://www.primevideo.com/detail/B0ABCD1234' }],
    });
    expect((await supportedTab({ anyTab: true }))?.id).toBe(9);
  });

  it('never borrows another tab for the popup when the active tab is not a player', async () => {
    // Regression: a popup opened over an unrelated site showed "episode
    // detected" for a player in some other tab, and its controls changed it.
    const { sendMessage } = stubTabs({
      active: { id: 1, url: 'https://example.com/', active: true },
      all: [{ id: 9, url: 'https://www.netflix.com/watch/1', audible: true }],
    });
    expect(await supportedTab()).toBeUndefined();
    await expect(sendContent({ type: 'CONTENT_GET_STATE' })).resolves.toBeUndefined();
    expect(sendMessage).not.toHaveBeenCalled();
  });

  it('prefers an audible player over an idle one', async () => {
    stubTabs({
      active: { id: 1, url: 'chrome-extension://abc/options.html', active: true },
      all: [
        { id: 4, url: 'https://www.netflix.com/watch/1' },
        { id: 5, url: 'https://tver.jp/episodes/abc', audible: true },
      ],
    });
    expect((await supportedTab({ anyTab: true }))?.id).toBe(5);
  });

  it('reports nothing when no player tab is open', async () => {
    stubTabs({ active: { id: 1, url: 'chrome-extension://abc/options.html', active: true }, all: [] });
    expect(await supportedTab({ anyTab: true })).toBeUndefined();
  });

  it('delivers a request to the player tab found that way', async () => {
    const { sendMessage } = stubTabs({
      active: { id: 1, url: 'chrome-extension://abc/options.html', active: true },
      all: [{ id: 9, url: 'https://www.primevideo.com/detail/B0ABCD1234' }],
      onSend: () => ({ ok: true, value: { platform: 'prime' } }),
    });
    const value = await sendContent<{ platform: string }>({ type: 'CONTENT_GET_DEBUG' }, { anyTab: true });
    expect(value).toEqual({ platform: 'prime' });
    expect(sendMessage).toHaveBeenCalledWith(9, { type: 'CONTENT_GET_DEBUG' });
  });
});
