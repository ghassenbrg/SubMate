import { afterEach, describe, expect, it, vi } from 'vitest';
import { observeVideoElement } from '../../src/core/playback/video-observer';
import { withRetry } from '../../src/core/retry';
import { canonicalPrimary, isJapanese, primarySubtag, sameLanguage } from '../../src/core/subtitles/language';

afterEach(() => document.body.replaceChildren());

const nextTick = () => new Promise((resolve) => setTimeout(resolve, 0));

describe('language matching', () => {
  it('reduces regional and underscore forms to a primary subtag', () => {
    expect(primarySubtag('ja-JP')).toBe('ja');
    expect(primarySubtag('pt_BR')).toBe('pt');
    expect(primarySubtag('  EN-gb ')).toBe('en');
  });

  it('treats ISO-639-2 aliases as the same language', () => {
    expect(canonicalPrimary('jpn')).toBe('ja');
    expect(sameLanguage('ja-JP', 'jpn')).toBe(true);
    expect(sameLanguage('fre', 'fr-CA')).toBe(true);
  });

  it('does not match unrelated languages or empty tags', () => {
    expect(sameLanguage('ja', 'ko')).toBe(false);
    expect(sameLanguage('', 'ja')).toBe(false);
    expect(isJapanese(undefined)).toBe(false);
    expect(isJapanese('ja-JP')).toBe(true);
  });
});

describe('video element observation', () => {
  it('reports the first matching element and later replacements', async () => {
    const seen: Array<HTMLVideoElement | null> = [];
    const stop = observeVideoElement('video', (video) => seen.push(video));
    // No media element yet, and the observer does not emit a spurious null.
    expect(seen).toEqual([]);

    const first = document.createElement('video');
    document.body.append(first);
    await nextTick();
    expect(seen.at(-1)).toBe(first);

    // A player swapping its media element must produce a new notification.
    first.remove();
    const second = document.createElement('video');
    document.body.append(second);
    await nextTick();
    expect(seen.at(-1)).toBe(second);
    stop();
  });

  it('does not re-notify while the same element stays mounted', async () => {
    const video = document.createElement('video');
    document.body.append(video);
    const seen: Array<HTMLVideoElement | null> = [];
    const stop = observeVideoElement('video', (v) => seen.push(v));
    document.body.append(document.createElement('div'));
    await nextTick();
    expect(seen).toEqual([video]);
    stop();
  });

  it('stops notifying after disposal, leaving no observer behind', async () => {
    const seen: Array<HTMLVideoElement | null> = [];
    const stop = observeVideoElement('video', (video) => seen.push(video));
    stop();
    document.body.append(document.createElement('video'));
    await nextTick();
    expect(seen).toEqual([]);
  });

  it('honours a custom selection strategy', async () => {
    const a = document.createElement('video');
    a.dataset.role = 'ad';
    const b = document.createElement('video');
    b.dataset.role = 'content';
    document.body.append(a, b);
    const seen: Array<HTMLVideoElement | null> = [];
    const stop = observeVideoElement('video', (v) => seen.push(v), {
      pickBest: (candidates) => candidates.find((c) => c.dataset.role === 'content') ?? null,
    });
    expect(seen.at(-1)).toBe(b);
    stop();
  });
});

describe('retry policy', () => {
  it('returns the first successful attempt without sleeping', async () => {
    const sleep = vi.fn(async () => undefined);
    const result = await withRetry(async () => 'ok', { sleep });
    expect(result).toBe('ok');
    expect(sleep).not.toHaveBeenCalled();
  });

  it('retries on the documented backoff schedule and then succeeds', async () => {
    const delays: number[] = [];
    let attempts = 0;
    const result = await withRetry(
      async () => {
        attempts += 1;
        if (attempts < 3) throw new Error('flaky');
        return attempts;
      },
      { sleep: async (ms) => { delays.push(ms); } },
    );
    expect(result).toBe(3);
    expect(delays).toEqual([500, 1_500]);
  });

  it('gives up after a bounded number of attempts instead of looping forever', async () => {
    let attempts = 0;
    await expect(withRetry(
      async () => { attempts += 1; throw new Error('always down'); },
      { sleep: async () => undefined },
    )).rejects.toThrow('always down');
    expect(attempts).toBe(4);
  });

  it('propagates an abort immediately without further attempts', async () => {
    const controller = new AbortController();
    controller.abort(new DOMException('Episode changed', 'AbortError'));
    let attempts = 0;
    await expect(withRetry(
      async () => { attempts += 1; return 'never'; },
      { signal: controller.signal, sleep: async () => undefined },
    )).rejects.toThrow(/Episode changed/);
    expect(attempts).toBe(0);
  });

  it('never retries an abort raised mid-flight', async () => {
    let attempts = 0;
    await expect(withRetry(
      async () => { attempts += 1; throw new DOMException('Aborted', 'AbortError'); },
      { sleep: async () => undefined },
    )).rejects.toThrow(/Aborted/);
    expect(attempts).toBe(1);
  });
});
