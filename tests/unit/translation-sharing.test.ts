import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { CachedTranslation, SubtitleTrack, TranslationRequest, TranslationResult } from '../../src/subtitles/models';
import type { TranslationProgress, TranslationProvider } from '../../src/translation/provider';
import type { SharedProgress, TranslationCoordinator, TranslationLease } from '../../src/translation/translation-coordinator';
import { fakeStorageArea } from '../support/chrome-storage-area';

const cache = vi.hoisted(() => new Map<string, unknown>());
vi.mock('../../src/cache/messages', () => ({
  sendCacheMessage: async (message: { type: string; cacheKey?: string; record?: CachedTranslation }) => {
    if (message.type === 'CACHE_GET_TRANSLATION') return cache.get(message.cacheKey!);
    if (message.type === 'CACHE_PUT_TRANSLATION') cache.set(message.record!.cacheKey, message.record);
    return undefined;
  },
}));

import {
  acquireLease,
  leaseStatus,
  releaseLease,
  releaseTabLeases,
  renewLease,
} from '../../src/background/translation-leases';
import { TranslationManager } from '../../src/translation/translation-manager';
import { WorkerTranslationCoordinator } from '../../src/translation/translation-coordinator';

const originalChrome = globalThis.chrome;

/** One tab's coordinator, talking to the real lease store as that tab. */
class TabCoordinator implements TranslationCoordinator {
  private jobs = 0;
  constructor(private readonly tabId: number) {}
  async acquire(cacheKey: string): Promise<TranslationLease | undefined> {
    const holder = `tab${this.tabId}-job${(this.jobs += 1)}`;
    const result = await acquireLease(cacheKey, { holder, tabId: this.tabId, frameId: 0, documentId: `doc${this.tabId}` });
    if (!result.granted) return undefined;
    return {
      report: (progress: TranslationProgress) => void renewLease(cacheKey, holder, progress),
      release: () => releaseLease(cacheKey, holder),
    };
  }
  async status(cacheKey: string): Promise<SharedProgress | undefined> {
    const status = await leaseStatus(cacheKey);
    if (!status.held) return undefined;
    const { held: _held, ...progress } = status;
    return progress;
  }
}

class GatedProvider implements TranslationProvider {
  readonly id = 'chrome-local';
  readonly version = 'v1';
  calls = 0;
  private gates: Array<{ resolve: () => void; reject: (error: unknown) => void }> = [];
  async availability() { return 'available' as const; }
  needsActivation() { return false; }
  async activate() {}
  async translate(input: TranslationRequest, onProgress?: (progress: TranslationProgress) => void, signal?: AbortSignal): Promise<TranslationResult> {
    this.calls += 1;
    onProgress?.({ phase: 'translating', progress: 0.5, completedCues: 1, totalCues: 2 });
    await new Promise<void>((resolve, reject) => {
      this.gates.push({ resolve, reject });
      signal?.addEventListener('abort', () => reject(signal.reason), { once: true });
    });
    return {
      sourceHash: input.sourceHash, sourceLanguage: input.sourceLanguage, targetLanguage: input.targetLanguage,
      engine: { id: this.id, version: this.version },
      translations: input.cues.map((cue) => ({ id: cue.id, text: `fr: ${cue.text}` })),
    };
  }
  finish(index = 0) { this.gates[index]?.resolve(); }
  fail(index = 0) { this.gates[index]?.reject(new Error('model crashed')); }
  destroy() {}
}

const source: SubtitleTrack = {
  platform: 'netflix', contentId: '1', trackId: 't', sourceLanguage: 'de', kind: 'text', sourceHash: 'sha256:abc',
  cues: [
    { id: 'a', startMs: 0, endMs: 1_000, sourceText: 'Hallo' },
    { id: 'b', startMs: 1_000, endMs: 2_000, sourceText: 'Welt' },
  ],
};

beforeEach(() => {
  cache.clear();
  Object.defineProperty(globalThis, 'chrome', {
    configurable: true,
    writable: true,
    value: { storage: { session: fakeStorageArea() } },
  });
});

afterEach(() => {
  vi.useRealTimers();
  Object.defineProperty(globalThis, 'chrome', { configurable: true, writable: true, value: originalChrome });
});

describe('translation shared across tabs', () => {
  it('translates an episode once when two tabs play it together', async () => {
    const provider = new GatedProvider();
    const tab1 = new TranslationManager(new TabCoordinator(1));
    const tab2 = new TranslationManager(new TabCoordinator(2));
    const waiting: SharedProgress[] = [];

    const first = tab1.translate(source, 'fr', provider, () => undefined, new AbortController().signal);
    await vi.waitFor(() => expect(provider.calls).toBe(1));
    const second = tab2.translate(source, 'fr', provider, () => undefined, new AbortController().signal, {
      onWaiting: (progress) => waiting.push(progress),
    });
    await vi.waitFor(() => expect(waiting.length).toBeGreaterThan(0));
    expect(waiting[0]).toMatchObject({ progress: 0.5, completedCues: 1, totalCues: 2 });

    provider.finish();
    const [a, b] = await Promise.all([first, second]);
    expect(provider.calls).toBe(1);
    expect(b.cacheKey).toBe(a.cacheKey);
    expect(b.translations).toEqual(a.translations);
  });

  it('reports an in-flight job before activation, and nothing when there is none', async () => {
    const provider = new GatedProvider();
    const tab1 = new TranslationManager(new TabCoordinator(1));
    const tab2 = new TranslationManager(new TabCoordinator(2));
    const signal = new AbortController().signal;
    await expect(tab2.awaitShared(source, 'fr', provider, () => undefined, signal)).resolves.toBeUndefined();

    const first = tab1.translate(source, 'fr', provider, () => undefined, signal);
    await vi.waitFor(() => expect(provider.calls).toBe(1));
    const shared = tab2.awaitShared(source, 'fr', provider, () => undefined, signal);
    provider.finish();
    await expect(shared).resolves.toMatchObject({ targetLanguage: 'fr' });
    await first;
  });

  it('takes over when the translating tab fails', async () => {
    const provider = new GatedProvider();
    const tab1 = new TranslationManager(new TabCoordinator(1));
    const tab2 = new TranslationManager(new TabCoordinator(2));
    const signal = new AbortController().signal;

    const first = tab1.translate(source, 'fr', provider, () => undefined, signal);
    await vi.waitFor(() => expect(provider.calls).toBe(1));
    const second = tab2.translate(source, 'fr', provider, () => undefined, signal, { onWaiting: () => undefined });
    await new Promise((resolve) => setTimeout(resolve, 20));
    provider.fail(0);
    await expect(first).rejects.toThrow('model crashed');
    await vi.waitFor(() => expect(provider.calls).toBe(2), { timeout: 3_000 });
    provider.finish(1);
    await expect(second).resolves.toMatchObject({ targetLanguage: 'fr' });
  });

  it('stops waiting as soon as the waiting tab moves on', async () => {
    const provider = new GatedProvider();
    const tab1 = new TranslationManager(new TabCoordinator(1));
    const tab2 = new TranslationManager(new TabCoordinator(2));
    const first = tab1.translate(source, 'fr', provider, () => undefined, new AbortController().signal);
    await vi.waitFor(() => expect(provider.calls).toBe(1));
    const controller = new AbortController();
    const second = tab2.translate(source, 'fr', provider, () => undefined, controller.signal, { onWaiting: () => undefined });
    await new Promise((resolve) => setTimeout(resolve, 20));
    controller.abort(new DOMException('Episode changed', 'AbortError'));
    await expect(second).rejects.toMatchObject({ name: 'AbortError' });
    provider.finish();
    await first;
    expect(provider.calls).toBe(1);
  });

  it('lets a waiter take over immediately when the translating tab closes', async () => {
    const provider = new GatedProvider();
    const tab1 = new TranslationManager(new TabCoordinator(1));
    const tab2 = new TranslationManager(new TabCoordinator(2));
    void tab1.translate(source, 'fr', provider, () => undefined, new AbortController().signal).catch(() => undefined);
    await vi.waitFor(() => expect(provider.calls).toBe(1));
    const second = tab2.translate(source, 'fr', provider, () => undefined, new AbortController().signal, { onWaiting: () => undefined });
    await new Promise((resolve) => setTimeout(resolve, 20));
    await releaseTabLeases(1);
    await vi.waitFor(() => expect(provider.calls).toBe(2), { timeout: 3_000 });
    provider.finish(1);
    await expect(second).resolves.toMatchObject({ targetLanguage: 'fr' });
  });
});

describe('worker translation coordinator', () => {
  it('renews while held, publishes progress and releases once', async () => {
    vi.useFakeTimers();
    const sendMessage = vi.fn(async (message: { type: string }) => ({
      ok: true,
      value: message.type === 'TRANSLATION_LEASE_ACQUIRE' ? { granted: true } : true,
    }));
    Object.defineProperty(globalThis, 'chrome', { configurable: true, writable: true, value: { runtime: { sendMessage } } });
    const lease = await new WorkerTranslationCoordinator().acquire('sha256:key');
    expect(lease).toBeDefined();
    lease!.report({ phase: 'translating', progress: 0.25, completedCues: 5, totalCues: 20 });
    expect(sendMessage).toHaveBeenLastCalledWith(expect.objectContaining({
      type: 'TRANSLATION_LEASE_RENEW', progress: { progress: 0.25, completedCues: 5, totalCues: 20 },
    }));
    const renewals = () => sendMessage.mock.calls.filter(([message]) => message.type === 'TRANSLATION_LEASE_RENEW').length;
    const before = renewals();
    await vi.advanceTimersByTimeAsync(8_000);
    expect(renewals()).toBe(before + 1);
    await lease!.release();
    await lease!.release();
    await vi.advanceTimersByTimeAsync(20_000);
    expect(renewals()).toBe(before + 1);
    expect(sendMessage.mock.calls.filter(([message]) => message.type === 'TRANSLATION_LEASE_RELEASE')).toHaveLength(1);
  });

  it('defers to another holder, and fails open when the worker is gone', async () => {
    const sendMessage = vi.fn(async (message: { type: string }) => ({
      ok: true,
      value: message.type === 'TRANSLATION_LEASE_ACQUIRE' ? { granted: false } : { held: true, progress: 0.7 },
    }));
    Object.defineProperty(globalThis, 'chrome', { configurable: true, writable: true, value: { runtime: { sendMessage } } });
    const coordinator = new WorkerTranslationCoordinator();
    await expect(coordinator.acquire('k')).resolves.toBeUndefined();
    await expect(coordinator.status('k')).resolves.toEqual({ progress: 0.7 });

    sendMessage.mockRejectedValue(new Error('Extension context invalidated'));
    await expect(coordinator.acquire('k')).resolves.toBeDefined();
    await expect(coordinator.status('k')).resolves.toBeUndefined();
  });
});
