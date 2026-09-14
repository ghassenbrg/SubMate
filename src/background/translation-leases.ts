import { createKeyedQueue } from '../core/concurrency';

/**
 * Cross-tab coordination for translation jobs.
 *
 * Two tabs playing the same episode into the same language with the same engine
 * produce the same cache entry. The first to ask holds a lease on that cache
 * key; the others wait and read its result from the cache instead of paying for
 * the translation again.
 *
 * A lease is only a hint: it expires unless renewed, so a crashed, reloaded or
 * closed holder costs a waiter at most one TTL before it takes over. Leases are
 * mirrored to `storage.session` so a worker shutdown mid-episode does not
 * silently let a second tab start a duplicate job.
 */

/**
 * Long enough to outlast Chrome's intensive timer throttling of hidden tabs,
 * which can delay a renewal to once a minute. A closed or reloaded holder is
 * released immediately, so only a crashed one ever waits this out.
 */
export const LEASE_TTL_MS = 90_000;

const PREFIX = 'translationLease:';
const storageKey = (cacheKey: string) => `${PREFIX}${cacheKey}`;
const serialized = createKeyedQueue();

export interface LeaseOwner {
  holder: string;
  tabId: number;
  frameId: number;
  documentId?: string | undefined;
}

export interface LeaseProgress {
  progress?: number | undefined;
  completedCues?: number | undefined;
  totalCues?: number | undefined;
}

interface Lease extends LeaseOwner, LeaseProgress {
  expiresAt: number;
}

export type LeaseStatus = { held: false } | ({ held: true } & LeaseProgress);

async function read(cacheKey: string): Promise<Lease | undefined> {
  const key = storageKey(cacheKey);
  const stored = (await chrome.storage.session.get(key))[key] as Lease | undefined;
  return stored && typeof stored.holder === 'string' && typeof stored.expiresAt === 'number' ? stored : undefined;
}

const progressOf = (lease: Lease): LeaseProgress => ({
  ...(lease.progress !== undefined ? { progress: lease.progress } : {}),
  ...(lease.completedCues !== undefined ? { completedCues: lease.completedCues } : {}),
  ...(lease.totalCues !== undefined ? { totalCues: lease.totalCues } : {}),
});

/**
 * The frame that held this lease has been replaced by a new document (reload
 * or navigation), so the old job is certainly dead and need not time out.
 */
const supersededBy = (lease: Lease, owner: LeaseOwner) =>
  lease.tabId === owner.tabId &&
  lease.frameId === owner.frameId &&
  Boolean(owner.documentId) &&
  lease.documentId !== owner.documentId;

export const acquireLease = (
  cacheKey: string,
  owner: LeaseOwner,
  now = Date.now(),
): Promise<{ granted: true } | ({ granted: false } & LeaseProgress)> =>
  serialized(cacheKey, async () => {
    const current = await read(cacheKey);
    if (current && current.holder !== owner.holder && current.expiresAt > now && !supersededBy(current, owner)) {
      return { granted: false, ...progressOf(current) };
    }
    const lease: Lease = { ...owner, expiresAt: now + LEASE_TTL_MS };
    await chrome.storage.session.set({ [storageKey(cacheKey)]: lease });
    return { granted: true };
  });

/** Extends the lease and records progress. False when it was lost. */
export const renewLease = (
  cacheKey: string,
  holder: string,
  progress: LeaseProgress,
  now = Date.now(),
): Promise<boolean> =>
  serialized(cacheKey, async () => {
    const current = await read(cacheKey);
    if (!current || current.holder !== holder) return false;
    const lease: Lease = { ...current, ...progress, expiresAt: now + LEASE_TTL_MS };
    await chrome.storage.session.set({ [storageKey(cacheKey)]: lease });
    return true;
  });

export const releaseLease = (cacheKey: string, holder: string): Promise<void> =>
  serialized(cacheKey, async () => {
    const current = await read(cacheKey);
    if (current?.holder === holder) await chrome.storage.session.remove(storageKey(cacheKey));
  });

export const leaseStatus = (cacheKey: string, now = Date.now()): Promise<LeaseStatus> =>
  serialized(cacheKey, async () => {
    const current = await read(cacheKey);
    if (!current || current.expiresAt <= now) return { held: false };
    return { held: true, ...progressOf(current) };
  });

/** Drops every lease a closed tab was holding, so waiters take over at once. */
export async function releaseTabLeases(tabId: number): Promise<void> {
  const stored = await chrome.storage.session.get(null);
  const cacheKeys = Object.entries(stored)
    .filter(([key, value]) => key.startsWith(PREFIX) && (value as Lease | undefined)?.tabId === tabId)
    .map(([key]) => key.slice(PREFIX.length));
  await Promise.all(cacheKeys.map((cacheKey) =>
    serialized(cacheKey, async () => {
      const current = await read(cacheKey);
      if (current?.tabId === tabId) await chrome.storage.session.remove(storageKey(cacheKey));
    })));
}
