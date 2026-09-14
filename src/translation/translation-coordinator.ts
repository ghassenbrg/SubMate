import { requestWorker } from '../core/worker-request';
import type { TranslationProgress } from './provider';

export interface SharedProgress {
  progress?: number | undefined;
  completedCues?: number | undefined;
  totalCues?: number | undefined;
}

/** Permission to run one translation job; release it however the job ends. */
export interface TranslationLease {
  report(progress: TranslationProgress): void;
  release(): Promise<void>;
}

/**
 * Keeps two tabs from translating the same cache entry at the same time.
 *
 * `acquire` resolves undefined while another tab holds the job; `status`
 * resolves undefined once nobody does.
 */
export interface TranslationCoordinator {
  acquire(cacheKey: string): Promise<TranslationLease | undefined>;
  status(cacheKey: string): Promise<SharedProgress | undefined>;
}

/** How often a holder renews its lease; well inside the worker's 90 s TTL. */
export const LEASE_RENEW_MS = 8_000;

const noopLease: TranslationLease = { report: () => undefined, release: async () => undefined };

/**
 * Coordinates through the background worker.
 *
 * Fails open: if the worker cannot be reached, translating twice is a far
 * better outcome than a tab that never translates.
 */
export class WorkerTranslationCoordinator implements TranslationCoordinator {
  async acquire(cacheKey: string): Promise<TranslationLease | undefined> {
    const holder = crypto.randomUUID();
    let result: { granted: boolean };
    try {
      result = await requestWorker<{ granted: boolean }>({ type: 'TRANSLATION_LEASE_ACQUIRE', cacheKey, holder });
    } catch {
      return noopLease;
    }
    if (!result.granted) return undefined;

    let latest: SharedProgress = {};
    let released = false;
    const renew = () => requestWorker<boolean>({ type: 'TRANSLATION_LEASE_RENEW', cacheKey, holder, progress: latest })
      .catch(() => undefined);
    const timer = setInterval(() => void renew(), LEASE_RENEW_MS);
    let lastReported = 0;
    return {
      report(progress) {
        if (progress.phase !== 'translating') return;
        latest = {
          progress: progress.progress,
          ...(progress.completedCues !== undefined ? { completedCues: progress.completedCues } : {}),
          ...(progress.totalCues !== undefined ? { totalCues: progress.totalCues } : {}),
        };
        // Progress fires per cue on the on-device engine; waiters poll about
        // once a second, so publishing more often than that is wasted work.
        const now = Date.now();
        if (now - lastReported < 1_000) return;
        lastReported = now;
        void renew();
      },
      async release() {
        if (released) return;
        released = true;
        clearInterval(timer);
        await requestWorker({ type: 'TRANSLATION_LEASE_RELEASE', cacheKey, holder }).catch(() => undefined);
      },
    };
  }

  async status(cacheKey: string): Promise<SharedProgress | undefined> {
    try {
      const status = await requestWorker<{ held: boolean } & SharedProgress>({ type: 'TRANSLATION_LEASE_STATUS', cacheKey });
      if (!status.held) return undefined;
      const { held: _held, ...progress } = status;
      return progress;
    } catch {
      return undefined;
    }
  }
}
