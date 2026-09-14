/**
 * Runs at most `max` tasks at once; the rest wait in arrival order.
 */
export function createLimiter(max: number): <T>(task: () => Promise<T>) => Promise<T> {
  if (!Number.isInteger(max) || max < 1) throw new RangeError('Limiter needs a positive integer');
  let active = 0;
  const waiting: Array<() => void> = [];
  const next = () => {
    const start = waiting.shift();
    if (start) start();
    else active -= 1;
  };
  return <T>(task: () => Promise<T>): Promise<T> => new Promise<T>((resolve, reject) => {
    const run = () => {
      // Deferred so a synchronous throw in `task` still releases the slot.
      Promise.resolve().then(task).then(resolve, reject).finally(next);
    };
    if (active < max) {
      active += 1;
      run();
    } else {
      waiting.push(run);
    }
  });
}

/**
 * Serializes tasks that share a key. Storage reads and writes in the worker are
 * asynchronous, so two messages for the same tab or lease could otherwise both
 * read the old value and both write, losing one update.
 */
export function createKeyedQueue(): <T>(key: string, task: () => Promise<T>) => Promise<T> {
  const tails = new Map<string, Promise<unknown>>();
  return <T>(key: string, task: () => Promise<T>): Promise<T> => {
    const previous = tails.get(key) ?? Promise.resolve();
    const result = previous.catch(() => undefined).then(task);
    const tail = result.catch(() => undefined);
    tails.set(key, tail);
    void tail.then(() => {
      if (tails.get(key) === tail) tails.delete(key);
    });
    return result;
  };
}
