import { describe, expect, it, vi } from 'vitest';
import { requestPageSubtitle } from '../../src/content/message-bridge';
import { BRIDGE_NAMESPACE } from '../../src/netflix/netflix-types';

describe('page subtitle data bridge', () => {
  it('requests a captured identity without accepting or transmitting a URL', async () => {
    const observed: Record<string, unknown>[] = [];
    const listener = (event: MessageEvent) => {
      const data = event.data as Record<string, unknown>;
      if (data?.type !== 'subtitle-request') return;
      observed.push(data);
      window.dispatchEvent(new MessageEvent('message', {
        source: window,
        origin: location.origin,
        data: { namespace: BRIDGE_NAMESPACE, type: 'subtitle-response', requestId: data.requestId, ok: true, text: '<tt/>', contentType: 'application/ttml+xml' },
      }));
    };
    window.addEventListener('message', listener);
    await expect(requestPageSubtitle('123', 'track-de', 'dfxp-ls-sdh')).resolves.toEqual({ text: '<tt/>', contentType: 'application/ttml+xml' });
    window.removeEventListener('message', listener);
    expect(observed[0]).toMatchObject({ contentId: '123', trackId: 'track-de', profile: 'dfxp-ls-sdh' });
    expect(observed[0]).not.toHaveProperty('url');
  });

  it('ignores spoofed response IDs and supports cancellation', async () => {
    vi.useFakeTimers();
    const controller = new AbortController();
    const promise = requestPageSubtitle('123', 'track', 'profile', controller.signal);
    window.dispatchEvent(new MessageEvent('message', { source: window, origin: location.origin, data: { namespace: BRIDGE_NAMESPACE, type: 'subtitle-response', requestId: 'wrong-request-id', ok: true, text: 'spoof', contentType: 'text/plain' } }));
    controller.abort(new DOMException('Episode changed', 'AbortError'));
    await expect(promise).rejects.toMatchObject({ name: 'AbortError' });
    vi.useRealTimers();
  });
});
