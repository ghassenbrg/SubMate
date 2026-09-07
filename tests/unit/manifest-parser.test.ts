import { describe, expect, it } from 'vitest';
import { chooseSourceTrack, chooseTextDownload, isManifestSnapshot, snapshotFromManifest } from '../../src/netflix/manifest-parser';
import { isAllowedNetflixSubtitleUrl } from '../../src/netflix/url-policy';

const manifest = {
  result: {
    movieId: 81726714,
    recommendedMedia: { textTrackId: 'T:de', audioTrackId: 'A:de' },
    audioTracks: [{ id: 'A:de', language: 'de', isNative: true }],
    textTracks: [
      { id: 'off;0;0;0;1;', language: 'zxx', languageDescription: 'Off', isNoneTrack: true, hydrated: true, downloadables: {} },
      { id: 'T:ar', language: 'ar', languageDescription: 'العربية', hydrated: true, downloadables: { 'dfxp-ls-sdh': { downloadUrls: { a: 'https://sub.nflxvideo.net/ar.xml' } } } },
      { id: 'T:de', language: 'de', languageDescription: 'Deutsch', hydrated: true, downloadables: {
        'image-profile': { isImage: true, downloadUrls: { a: 'https://sub.nflxvideo.net/de.zip' } },
        'dfxp-ls-sdh': { downloadUrls: { a: 'https://sub.nflxvideo.net/de.xml', evil: 'https://evil.example/x' } },
      } },
    ],
  },
};

describe('Netflix manifest sanitization and selection', () => {
  it('supports the current camelCase schema and removes untrusted URLs', () => {
    const snapshot = snapshotFromManifest(manifest, 10);
    expect(snapshot?.contentId).toBe('81726714');
    expect(snapshot?.tracks[2]?.downloads[1]?.urls).toEqual(['https://sub.nflxvideo.net/de.xml']);
    expect(isManifestSnapshot(snapshot)).toBe(true);
  });

  it('supports legacy field names and URL arrays', () => {
    const snapshot = snapshotFromManifest({ movie_id: '55', timedtexttracks: [{ new_track_id: 'T:fr', language: 'fr', ttDownloadables: { profile: { urls: [{ url: 'https://assets.nflxext.com/fr.xml' }] } } }] });
    expect(snapshot?.tracks[0]?.trackId).toBe('T:fr');
  });

  it('chooses preferred, active, audio, then first textual tracks generically', () => {
    const snapshot = snapshotFromManifest(manifest)!;
    expect(chooseSourceTrack(snapshot, 'fr', 'ar').source?.language).toBe('ar');
    expect(chooseSourceTrack(snapshot, 'fr').source?.language).toBe('de');
    expect(chooseSourceTrack(snapshot, 'ar').targetAlreadyAvailable).toBe(true);
    expect(chooseTextDownload(snapshot.tracks[2]!)?.profile).toBe('dfxp-ls-sdh');
  });

  it('prefers a full dialogue track over an earlier forced-narrative track in the same language', () => {
    const snapshot = snapshotFromManifest({
      movieId: '83068200',
      audioTracks: [{ language: 'ja', isNative: true }],
      textTracks: [
        { id: 'T:ja-forced', language: 'ja', rawTrackType: 'forced-narrative', isForcedNarrative: true, hydrated: true, downloadables: { 'dfxp-ls-sdh': { downloadUrls: { a: 'https://sub.nflxvideo.net/ja-forced.xml' } } } },
        { id: 'T:ja-dialogue', language: 'ja', rawTrackType: 'subtitles', hydrated: true, downloadables: { 'dfxp-ls-sdh': { downloadUrls: { a: 'https://sub.nflxvideo.net/ja-dialogue.xml' } } } },
      ],
    })!;
    expect(chooseSourceTrack(snapshot, 'en').source?.trackId).toBe('T:ja-dialogue');
  });

  it('rejects non-HTTPS, credentials, lookalike hosts, and arbitrary origins', () => {
    expect(isAllowedNetflixSubtitleUrl('https://a.nflxvideo.net/sub')).toBe(true);
    expect(isAllowedNetflixSubtitleUrl('http://a.nflxvideo.net/sub')).toBe(false);
    expect(isAllowedNetflixSubtitleUrl('https://user:pass@a.nflxvideo.net/sub')).toBe(false);
    expect(isAllowedNetflixSubtitleUrl('https://nflxvideo.net.evil.test/sub')).toBe(false);
    expect(isAllowedNetflixSubtitleUrl('https://evil.test/sub')).toBe(false);
  });
});
