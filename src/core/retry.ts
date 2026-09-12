/** Conservative backoff schedule shared by subtitle and manifest fetching. */
export const RETRY_DELAYS_MS = [500, 1_500, 3_000] as const;

export interface RetryOptions {
  /** Delays between attempts. Attempt count is `delays.length + 1`. */
  delays?: readonly number[];
  signal?: AbortSignal;
  onRetry?: (attempt: number, error: unknown) => void;
  sleep?: (ms: number, signal?: AbortSignal) => Promise<void>;
}

const defaultSleep = (ms: number, signal?: AbortSignal): Promise<void> =>
  new Promise((resolve, reject) => {
    if (signal?.aborted) {
      reject(signal.reason ?? new DOMException('Aborted', 'AbortError'));
      return;
    }
    const timer = setTimeout(() => {
      signal?.removeEventListener('abort', onAbort);
      resolve();
    }, ms);
    const onAbort = () => {
      clearTimeout(timer);
      reject(signal?.reason ?? new DOMException('Aborted', 'AbortError'));
    };
    signal?.addEventListener('abort', onAbort, { once: true });
  });

/**
 * Retries an operation a bounded number of times.
 *
 * Aborts propagate immediately and are never retried, so an episode change can
 * cancel in-flight work instead of waiting out the backoff schedule.
 */
export async function withRetry<T>(operation: () => Promise<T>, options: RetryOptions = {}): Promise<T> {
  const delays = options.delays ?? RETRY_DELAYS_MS;
  const sleep = options.sleep ?? defaultSleep;
  let lastError: unknown;
  for (let attempt = 0; attempt <= delays.length; attempt += 1) {
    if (options.signal?.aborted) throw options.signal.reason ?? new DOMException('Aborted', 'AbortError');
    try {
      return await operation();
    } catch (error) {
      if (error instanceof DOMException && error.name === 'AbortError') throw error;
      lastError = error;
      const delay = delays[attempt];
      if (delay === undefined) break;
      options.onRetry?.(attempt + 1, error);
      await sleep(delay, options.signal);
    }
  }
  throw lastError;
}
