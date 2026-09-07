import { describe, expect, it } from 'vitest';
import type { NetflixManifestSnapshot } from '../../src/netflix/netflix-types';
import { ManifestCaptureState } from '../../src/page/manifest-capture-state';

const snapshot = (contentId: string, url = 'https://sub.nflxvideo.net/episode.xml'): NetflixManifestSnapshot => ({
  protocolVersion: 1,
  contentId,
  capturedAt: 1,
  audioLanguage: 'ja',
  tracks: [{
    trackId: `T:${contentId}:ja`,
    language: 'ja',
    label: '日本語',
    isForcedNarrative: false,
    isNoneTrack: false,
    hydrated: true,
    downloads: [{ profile: 'dfxp-ls-sdh', kind: 'text', urls: [url] }],
  }],
});

describe('page-realm manifest capture state', () => {
  it('deduplicates unchanged captures and never exposes signed URLs', () => {
    const state = new ManifestCaptureState();
    const first = state.record(snapshot('100'));
    expect(first?.tracks[0]?.downloads[0]?.urls).toEqual([]);
    expect(state.record(snapshot('100'))).toBeUndefined();
  });

  it('replays a preloaded next-episode manifest after its route becomes current', () => {
    const state = new ManifestCaptureState();
    state.record(snapshot('200'));
    const replay = state.replay('200');
    expect(replay).toMatchObject({ contentId: '200', audioLanguage: 'ja' });
    expect(replay?.tracks[0]?.downloads[0]?.urls).toEqual([]);
    expect(state.replay('unknown')).toBeUndefined();
  });

  it('publishes a hydrated or URL-updated manifest again', () => {
    const state = new ManifestCaptureState();
    state.record(snapshot('300'));
    expect(state.record(snapshot('300', 'https://sub.nflxvideo.net/refreshed.xml'))).toBeDefined();
  });

  it('bounds retained preload state during long playback sessions', () => {
    const state = new ManifestCaptureState();
    for (let episode = 1; episode <= 10; episode += 1) state.record(snapshot(String(episode)));
    expect(state.replay('1')).toBeUndefined();
    expect(state.replay('2')).toBeUndefined();
    expect(state.replay('3')).toBeDefined();
    expect(state.replay('10')).toBeDefined();
  });
});
