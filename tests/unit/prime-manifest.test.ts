import { describe, expect, it } from 'vitest';
import { isPrimeVideoUrl, routeContentId } from '../../src/platforms/prime/prime-detection';
import {
  chooseSubtitleTrack,
  isPrimeSnapshot,
  scanForSubtitles,
  snapshotFromPlaybackResources,
} from '../../src/platforms/prime/prime-manifest';
import { isAllowedPrimeSubtitleUrl } from '../../src/platforms/prime/prime-url-policy';
import timedTextPvCdnFixture from '../fixtures/prime/playback-timedtext-pv-cdn.json';

const CDN = 'https://m.media-amazon.com/subs';

/** Shaped after Amazon's playback payload, with the pieces we rely on. */
const payload = () => ({
  catalogMetadata: { catalog: { id: 'B0ABCD1234', title: 'Example', originalLanguage: 'ja' } },
  subtitleUrls: [
    { url: `${CDN}/ja.dfxp`, languageCode: 'ja', displayName: '日本語', type: 'subtitle' },
    { url: `${CDN}/en.dfxp`, languageCode: 'en', displayName: 'English', type: 'subtitle' },
  ],
  forcedNarratives: [
    { url: `${CDN}/ja-forced.dfxp`, languageCode: 'ja', displayName: 'Japanese [Forced]' },
  ],
});

describe('Prime Video detection', () => {
  it('matches primevideo.com and Amazon video paths only', () => {
    expect(isPrimeVideoUrl(new URL('https://www.primevideo.com/detail/B0ABCD1234'))).toBe(true);
    expect(isPrimeVideoUrl(new URL('https://www.amazon.co.jp/gp/video/detail/B0ABCD1234'))).toBe(true);
    // The Amazon shop must never be treated as Prime Video.
    expect(isPrimeVideoUrl(new URL('https://www.amazon.co.jp/gp/cart/view.html'))).toBe(false);
    expect(isPrimeVideoUrl(new URL('https://www.amazon.com/s?k=headphones'))).toBe(false);
    expect(isPrimeVideoUrl(new URL('https://notprimevideo.com/detail/x'))).toBe(false);
    expect(isPrimeVideoUrl(new URL('https://www.netflix.com/watch/1'))).toBe(false);
  });

  it('reads the title id from every route shape that carries one', () => {
    expect(routeContentId('https://www.primevideo.com/detail/B0ABCD1234/ref=x')).toBe('B0ABCD1234');
    expect(routeContentId('https://www.amazon.co.jp/gp/video/detail/B0ABCD1234')).toBe('B0ABCD1234');
    expect(routeContentId('https://www.primevideo.com/region/eu/detail/B0ABCD1234')).toBe('B0ABCD1234');
    expect(routeContentId('https://www.primevideo.com/watch?asin=B0ABCD1234')).toBe('B0ABCD1234');
    expect(routeContentId('https://www.primevideo.com/storefront')).toBeUndefined();
    expect(routeContentId('not a url')).toBeUndefined();
  });
});

describe('Prime subtitle URL policy', () => {
  it('accepts Amazon-owned hosts across regions', () => {
    expect(isAllowedPrimeSubtitleUrl(`${CDN}/ja.dfxp`)).toBe(true);
    expect(isAllowedPrimeSubtitleUrl('https://d1.aiv-cdn.net/x.dfxp')).toBe(true);
    expect(isAllowedPrimeSubtitleUrl('https://cf-timedtext.aux.pv-cdn.net/redacted')).toBe(true);
    expect(isAllowedPrimeSubtitleUrl('https://www.amazon.co.jp/x.dfxp')).toBe(true);
  });

  it('rejects unrelated, insecure or credentialed URLs', () => {
    expect(isAllowedPrimeSubtitleUrl('https://evil.example.com/x.dfxp')).toBe(false);
    expect(isAllowedPrimeSubtitleUrl('http://m.media-amazon.com/x.dfxp')).toBe(false);
    expect(isAllowedPrimeSubtitleUrl('https://user:pw@m.media-amazon.com/x.dfxp')).toBe(false);
    // A lookalike host must not pass the suffix check.
    expect(isAllowedPrimeSubtitleUrl('https://media-amazon.com.evil.test/x')).toBe(false);
    expect(isAllowedPrimeSubtitleUrl('not a url')).toBe(false);
  });
});

describe('Prime playback payload parsing', () => {
  it('collects dialogue and forced tracks with the title id', () => {
    const snapshot = snapshotFromPlaybackResources(payload());
    expect(snapshot?.contentId).toBe('B0ABCD1234');
    expect(snapshot?.audioLanguage).toBe('ja');
    expect(snapshot?.subtitles).toHaveLength(3);
    expect(snapshot?.subtitles.filter((track) => track.forced)).toHaveLength(1);
  });

  it('finds tracks regardless of the key spelling or nesting used', () => {
    // Amazon has shipped several shapes for the same data; a fixed path would
    // silently stop matching after any of them changes.
    const snapshot = snapshotFromPlaybackResources({
      asin: 'B0ZZZZ9999',
      playbackResources: { timedText: { tracks: [{ uri: `${CDN}/de.vtt`, language: 'de', label: 'Deutsch' }] } },
    });
    expect(snapshot?.contentId).toBe('B0ZZZZ9999');
    expect(snapshot?.subtitles[0]?.language).toBe('de');
  });

  it('ignores payloads with no subtitle descriptors', () => {
    expect(snapshotFromPlaybackResources({ catalogMetadata: { catalog: { id: 'B0ABCD1234' } } })).toBeUndefined();
    expect(snapshotFromPlaybackResources({ unrelated: true })).toBeUndefined();
    expect(snapshotFromPlaybackResources(null)).toBeUndefined();
    expect(snapshotFromPlaybackResources('a string')).toBeUndefined();
  });

  it('never treats a non-Amazon URL as a subtitle track', () => {
    const snapshot = snapshotFromPlaybackResources({
      asin: 'B0ABCD1234',
      subtitleUrls: [
        { url: 'https://evil.example.com/x.dfxp', languageCode: 'en' },
        { url: `${CDN}/en.dfxp`, languageCode: 'en' },
      ],
    });
    expect(snapshot?.subtitles).toHaveLength(1);
    expect(snapshot?.subtitles[0]?.url).toContain('media-amazon.com');
  });

  it('falls back to the route title id when the payload omits one', () => {
    const snapshot = snapshotFromPlaybackResources(
      { subtitleUrls: [{ url: `${CDN}/en.dfxp`, languageCode: 'en' }] },
      'B0ROUTE1234',
    );
    expect(snapshot?.contentId).toBe('B0ROUTE1234');
  });

  it('survives deeply nested and oversized payloads without hanging', () => {
    let nested: Record<string, unknown> = { url: `${CDN}/en.dfxp`, languageCode: 'en' };
    for (let i = 0; i < 200; i += 1) nested = { child: nested };
    expect(() => snapshotFromPlaybackResources({ asin: 'B0ABCD1234', nested })).not.toThrow();
  });
});

describe('discovery resilience', () => {
  it('still produces a snapshot when neither payload nor route names the title', () => {
    // Regression: an unrecognised playback route made routeContentId() return
    // undefined, which discarded every payload and left the UI stuck on
    // "Finding available subtitles…".
    const snapshot = snapshotFromPlaybackResources({
      subtitleUrls: [{ url: `${CDN}/ja.dfxp`, languageCode: 'ja', displayName: '日本語' }],
    });
    expect(snapshot).toBeDefined();
    expect(snapshot?.contentId).toMatch(/^derived-/);
    expect(snapshot?.subtitles).toHaveLength(1);
  });

  it('derives a stable id from the track set, not from a signed URL', () => {
    const first = snapshotFromPlaybackResources({
      subtitleUrls: [{ url: `${CDN}/ja.dfxp?token=AAA`, languageCode: 'ja', displayName: '日本語' }],
    });
    // A rotated signature must not look like a different title.
    const second = snapshotFromPlaybackResources({
      subtitleUrls: [{ url: `${CDN}/ja.dfxp?token=ZZZ`, languageCode: 'ja', displayName: '日本語' }],
    });
    expect(first?.contentId).toBe(second?.contentId);
  });

  it('accepts subtitles fronted by CloudFront, which Amazon actually uses', () => {
    const snapshot = snapshotFromPlaybackResources({
      asin: 'B0ABCD1234',
      subtitleUrls: [{ url: 'https://d1abcdef.cloudfront.net/subs/ja.dfxp', languageCode: 'ja' }],
    });
    expect(snapshot?.subtitles).toHaveLength(1);
  });

  it('captures the redacted live timed-text descriptor from the Prime CDN family', () => {
    const snapshot = snapshotFromPlaybackResources(timedTextPvCdnFixture, 'B0LIVE12345');
    expect(snapshot?.contentId).toBe('B0LIVE12345');
    expect(snapshot?.subtitles).toEqual([
      expect.objectContaining({ language: 'ja', url: 'https://cf-timedtext.aux.pv-cdn.net/<redacted>' }),
    ]);
  });

  it('reports the hostname of a rejected descriptor, and never its path', () => {
    const scan = scanForSubtitles({
      subtitleUrls: [{ url: 'https://blocked.example.com/secret/path.dfxp?sig=SECRET', languageCode: 'ja' }],
    });
    expect(scan.accepted).toHaveLength(0);
    expect(scan.rejectedHosts).toEqual(['blocked.example.com']);
    // The diagnostic must never carry a signed path or query.
    expect(scan.rejectedHosts.join()).not.toContain('SECRET');
    expect(scan.rejectedHosts.join()).not.toContain('/');
  });
});

describe('Prime track selection', () => {
  it('prefers a full dialogue track over a forced-narrative one', () => {
    const snapshot = snapshotFromPlaybackResources(payload())!;
    const choice = chooseSubtitleTrack(snapshot, 'ar', 'ja');
    expect(choice.source?.language).toBe('ja');
    expect(choice.source?.forced).toBe(false);
  });

  it('reports the target as already available when Amazon supplies it', () => {
    const snapshot = snapshotFromPlaybackResources(payload())!;
    expect(chooseSubtitleTrack(snapshot, 'en').targetAlreadyAvailable).toBe(true);
    expect(chooseSubtitleTrack(snapshot, 'ar').targetAlreadyAvailable).toBe(false);
  });

  it('falls back to the audio language, then to any dialogue track', () => {
    const snapshot = snapshotFromPlaybackResources(payload())!;
    expect(chooseSubtitleTrack(snapshot, 'ar').source?.language).toBe('ja');
  });

  it('validates untrusted snapshots crossing the bridge', () => {
    expect(isPrimeSnapshot(snapshotFromPlaybackResources(payload()))).toBe(true);
    expect(isPrimeSnapshot({ protocolVersion: 2, contentId: 'x', capturedAt: 1, subtitles: [] })).toBe(false);
    expect(isPrimeSnapshot({ protocolVersion: 1, contentId: '', capturedAt: 1, subtitles: [] })).toBe(false);
    expect(isPrimeSnapshot(null)).toBe(false);
  });
});
