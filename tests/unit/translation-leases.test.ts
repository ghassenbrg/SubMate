import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { fakeStorageArea } from '../support/chrome-storage-area';

const originalChrome = globalThis.chrome;

beforeEach(() => {
  vi.resetModules();
  Object.defineProperty(globalThis, 'chrome', {
    configurable: true,
    writable: true,
    value: { storage: { session: fakeStorageArea() } },
  });
});

afterEach(() => {
  Object.defineProperty(globalThis, 'chrome', { configurable: true, writable: true, value: originalChrome });
});

const tabA = { holder: 'job-a', tabId: 1, frameId: 0, documentId: 'doc-a' };
const tabB = { holder: 'job-b', tabId: 2, frameId: 0, documentId: 'doc-b' };
const leases = () => import('../../src/background/translation-leases');

describe('translation leases', () => {
  it('grants one holder per cache key and reports its progress to others', async () => {
    const { acquireLease, leaseStatus, renewLease } = await leases();
    await expect(acquireLease('key', tabA, 0)).resolves.toEqual({ granted: true });
    await expect(acquireLease('other', tabB, 0)).resolves.toEqual({ granted: true });
    await expect(renewLease('key', 'job-a', { progress: 0.4, completedCues: 4, totalCues: 10 }, 1)).resolves.toBe(true);
    await expect(acquireLease('key', tabB, 2)).resolves.toEqual({ granted: false, progress: 0.4, completedCues: 4, totalCues: 10 });
    await expect(leaseStatus('key', 2)).resolves.toEqual({ held: true, progress: 0.4, completedCues: 4, totalCues: 10 });
  });

  it('lets two simultaneous requests produce exactly one holder', async () => {
    const { acquireLease } = await leases();
    const results = await Promise.all([acquireLease('key', tabA, 0), acquireLease('key', tabB, 0)]);
    expect(results.filter((result) => result.granted)).toHaveLength(1);
  });

  it('expires an abandoned lease unless it is renewed', async () => {
    const { LEASE_TTL_MS, acquireLease, leaseStatus, renewLease } = await leases();
    await acquireLease('key', tabA, 0);
    await renewLease('key', 'job-a', {}, LEASE_TTL_MS - 1);
    await expect(acquireLease('key', tabB, LEASE_TTL_MS + 1)).resolves.toMatchObject({ granted: false });
    await expect(leaseStatus('key', 2 * LEASE_TTL_MS)).resolves.toEqual({ held: false });
    await expect(acquireLease('key', tabB, 2 * LEASE_TTL_MS)).resolves.toEqual({ granted: true });
    // The old holder learns it lost the job.
    await expect(renewLease('key', 'job-a', {}, 2 * LEASE_TTL_MS)).resolves.toBe(false);
  });

  it('hands over at once when the holding frame reloads', async () => {
    const { acquireLease } = await leases();
    await acquireLease('key', tabA, 0);
    const reloaded = { ...tabA, holder: 'job-a2', documentId: 'doc-a-reloaded' };
    await expect(acquireLease('key', reloaded, 1)).resolves.toEqual({ granted: true });
    // A different frame of the same tab is still a separate, live document.
    await expect(acquireLease('key', { ...tabA, holder: 'job-frame', frameId: 3, documentId: 'doc-frame' }, 2))
      .resolves.toMatchObject({ granted: false });
  });

  it('frees the key on release and ignores releases by non-holders', async () => {
    const { acquireLease, leaseStatus, releaseLease } = await leases();
    await acquireLease('key', tabA, 0);
    await releaseLease('key', 'job-b');
    await expect(leaseStatus('key', 1)).resolves.toMatchObject({ held: true });
    await releaseLease('key', 'job-a');
    await expect(leaseStatus('key', 1)).resolves.toEqual({ held: false });
  });

  it('drops every lease of a closed tab', async () => {
    const { acquireLease, leaseStatus, releaseTabLeases } = await leases();
    await acquireLease('one', tabA, 0);
    await acquireLease('two', tabA, 0);
    await acquireLease('three', tabB, 0);
    await releaseTabLeases(1);
    await expect(leaseStatus('one', 1)).resolves.toEqual({ held: false });
    await expect(leaseStatus('two', 1)).resolves.toEqual({ held: false });
    await expect(leaseStatus('three', 1)).resolves.toMatchObject({ held: true });
  });
});
