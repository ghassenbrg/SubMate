import { describe, expect, it, vi } from 'vitest';
import { observeNetflixPlayer } from '../../src/content/player-observer';

describe('Netflix player observer', () => {
  it('follows player replacement and removal without duplicate callbacks', async () => {
    const callback = vi.fn();
    const stop = observeNetflixPlayer(callback);
    const first = document.createElement('video');
    document.body.append(first);
    await vi.waitFor(() => expect(callback).toHaveBeenLastCalledWith(first));

    document.body.append(document.createElement('div'));
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(callback).toHaveBeenCalledTimes(1);

    const second = document.createElement('video');
    first.replaceWith(second);
    await vi.waitFor(() => expect(callback).toHaveBeenLastCalledWith(second));
    second.remove();
    await vi.waitFor(() => expect(callback).toHaveBeenLastCalledWith(null));
    stop();
  });

  it('stops observing after cleanup', async () => {
    const callback = vi.fn();
    const stop = observeNetflixPlayer(callback);
    stop();
    document.body.append(document.createElement('video'));
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(callback).not.toHaveBeenCalled();
    document.querySelector('video')?.remove();
  });
});
