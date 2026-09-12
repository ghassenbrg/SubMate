import { describe, expect, it } from 'vitest';
import { createAdapters, platformLabel, selectAdapter } from '../../src/platforms';

describe('platform registry', () => {
  it('routes each supported site to exactly one adapter', () => {
    const cases: Array<[string, string]> = [
      ['https://www.netflix.com/watch/80100172', 'netflix'],
      ['https://tver.jp/episodes/epwkvwnxez', 'tver'],
      ['https://www.primevideo.com/detail/B0ABCD1234', 'prime'],
      ['https://www.amazon.co.jp/gp/video/detail/B0ABCD1234', 'prime'],
    ];
    for (const [href, expected] of cases) {
      const adapters = createAdapters();
      const matching = adapters.filter((adapter) => adapter.matches(new URL(href)));
      // Exactly one owner per URL: overlapping adapters would make the active
      // platform depend on registration order.
      expect(matching.map((adapter) => adapter.id), href).toEqual([expected]);
      expect(selectAdapter(new URL(href), adapters)?.id).toBe(expected);
    }
  });

  it('claims no unrelated site, including the Amazon shop', () => {
    for (const href of [
      'https://www.amazon.co.jp/gp/cart/view.html',
      'https://www.amazon.com/s?k=coffee',
      'https://www.youtube.com/watch?v=x',
      'https://example.com/',
    ]) {
      expect(selectAdapter(new URL(href)), href).toBeUndefined();
    }
  });

  it('gives every adapter a distinct id, a label and a capability set', () => {
    const adapters = createAdapters();
    const ids = adapters.map((adapter) => adapter.id);
    expect(new Set(ids).size).toBe(ids.length);
    for (const adapter of adapters) {
      expect(platformLabel(adapter.id)).not.toBe(adapter.id);
      expect(adapter.capabilities.supportsOriginalSubtitles).toBe(true);
      expect(typeof adapter.isAdPlaying()).toBe('boolean');
    }
  });
});
