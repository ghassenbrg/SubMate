import { describe, expect, it, vi } from 'vitest';
import { createKeyedQueue, createLimiter } from '../../src/core/concurrency';

const deferred = () => {
  let resolve!: () => void;
  const promise = new Promise<void>((done) => { resolve = done; });
  return { promise, resolve };
};

describe('createLimiter', () => {
  it('never runs more than the cap and starts waiters in order', async () => {
    const limit = createLimiter(2);
    const gates = [deferred(), deferred(), deferred()];
    const started: number[] = [];
    let active = 0;
    let peak = 0;
    const runs = gates.map((gate, index) => limit(async () => {
      started.push(index);
      active += 1;
      peak = Math.max(peak, active);
      await gate.promise;
      active -= 1;
      return index;
    }));
    await Promise.resolve();
    await Promise.resolve();
    expect(started).toEqual([0, 1]);
    gates[1]!.resolve();
    await runs[1];
    await vi.waitFor(() => expect(started).toHaveLength(3));
    expect(started).toEqual([0, 1, 2]);
    gates[0]!.resolve();
    gates[2]!.resolve();
    await expect(Promise.all(runs)).resolves.toEqual([0, 1, 2]);
    expect(peak).toBe(2);
  });

  it('frees the slot when a task throws', async () => {
    const limit = createLimiter(1);
    await expect(limit(() => { throw new Error('boom'); })).rejects.toThrow('boom');
    await expect(limit(async () => 'next')).resolves.toBe('next');
  });

  it('rejects a nonsensical cap', () => {
    expect(() => createLimiter(0)).toThrow(RangeError);
  });
});

describe('createKeyedQueue', () => {
  it('serializes tasks per key but not across keys', async () => {
    const run = createKeyedQueue();
    const order: string[] = [];
    const gate = deferred();
    const a1 = run('a', async () => { await gate.promise; order.push('a1'); });
    const a2 = run('a', async () => { order.push('a2'); });
    const b1 = run('b', async () => { order.push('b1'); });
    await b1;
    expect(order).toEqual(['b1']);
    gate.resolve();
    await Promise.all([a1, a2]);
    expect(order).toEqual(['b1', 'a1', 'a2']);
  });

  it('keeps going after a failed task', async () => {
    const run = createKeyedQueue();
    await expect(run('k', async () => { throw new Error('fail'); })).rejects.toThrow('fail');
    await expect(run('k', async () => 2)).resolves.toBe(2);
  });
});

