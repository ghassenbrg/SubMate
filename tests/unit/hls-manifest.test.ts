import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { isMasterManifest, parseAttributeList, parseMasterManifest, parseMediaPlaylist } from '../../src/core/hls/manifest';
import { isJapanese } from '../../src/core/subtitles/language';

const fixture = (name: string) =>
  readFile(resolve(import.meta.dirname, '..', 'fixtures', 'hls', name), 'utf8');

const MASTER_URL = 'https://cdn.example.jp/streams/abc123/master.m3u8?token=SIGNED';

describe('HLS attribute parsing', () => {
  it('keeps commas and equals signs inside quoted values intact', () => {
    const attributes = parseAttributeList('TYPE=SUBTITLES,NAME="Japanese, full",URI="a.m3u8?x=1,y=2",DEFAULT=YES');
    expect(attributes.TYPE).toBe('SUBTITLES');
    expect(attributes.NAME).toBe('Japanese, full');
    expect(attributes.URI).toBe('a.m3u8?x=1,y=2');
    expect(attributes.DEFAULT).toBe('YES');
  });

  it('tolerates an unterminated quote rather than throwing', () => {
    expect(() => parseAttributeList('NAME="unclosed')).not.toThrow();
  });
});

describe('master manifest subtitle discovery', () => {
  it('finds the Japanese subtitle track and resolves its relative URI', async () => {
    const text = await fixture('master-with-japanese-subtitles.m3u8');
    const subtitles = parseMasterManifest(text, MASTER_URL).filter((track) => track.type === 'SUBTITLES');
    expect(subtitles).toHaveLength(1);
    const [track] = subtitles;
    expect(track?.language).toBe('ja-JP');
    expect(isJapanese(track?.language)).toBe(true);
    expect(track?.isDefault).toBe(true);
    expect(track?.uri).toBe('https://cdn.example.jp/streams/abc123/subtitles/ja/playlist.m3u8');
  });

  it('distinguishes forced from full Japanese tracks and ignores other languages', async () => {
    const text = await fixture('master-with-multiple-subtitles.m3u8');
    const japanese = parseMasterManifest(text, MASTER_URL)
      .filter((track) => track.type === 'SUBTITLES')
      .filter((track) => isJapanese(track.language));
    expect(japanese).toHaveLength(2);
    // `jpn` must be recognised as Japanese alongside `ja`.
    expect(japanese.map((track) => track.language).sort()).toEqual(['ja', 'jpn']);
    expect(japanese.find((track) => track.forced)?.language).toBe('jpn');
    expect(japanese.find((track) => !track.forced)?.isDefault).toBe(true);
  });

  it('reports no subtitle tracks when the master has none', async () => {
    const text = await fixture('master-without-subtitles.m3u8');
    expect(parseMasterManifest(text, MASTER_URL).filter((t) => t.type === 'SUBTITLES')).toHaveLength(0);
  });

  it('returns nothing for malformed input instead of throwing', () => {
    expect(parseMasterManifest('not a manifest at all', MASTER_URL)).toEqual([]);
    expect(parseMasterManifest('', MASTER_URL)).toEqual([]);
  });

  it('identifies master versus media playlists', async () => {
    expect(isMasterManifest(await fixture('master-with-japanese-subtitles.m3u8'))).toBe(true);
    expect(isMasterManifest(await fixture('subtitle-playlist.m3u8'))).toBe(false);
  });
});

describe('subtitle media playlist', () => {
  it('accumulates segment start offsets from EXTINF durations', async () => {
    const playlist = parseMediaPlaylist(await fixture('subtitle-playlist.m3u8'), MASTER_URL);
    expect(playlist.complete).toBe(true);
    expect(playlist.targetDurationMs).toBe(10_000);
    expect(playlist.segments.map((segment) => segment.startMs)).toEqual([0, 10_000, 20_000]);
    expect(playlist.segments.at(-1)?.durationMs).toBe(8_500);
    expect(playlist.segments.at(-1)?.discontinuity).toBe(true);
  });

  it('resolves relative, parent-relative and root-relative segment URLs', async () => {
    const base = 'https://cdn.example.jp/streams/abc/subs/playlist.m3u8';
    const playlist = parseMediaPlaylist(await fixture('subtitle-playlist-relative-urls.m3u8'), base);
    expect(playlist.segments.map((segment) => segment.uri)).toEqual([
      'https://cdn.example.jp/streams/abc/subs/seg-000.vtt',
      'https://cdn.example.jp/streams/abc/shared/seg-001.vtt',
      'https://cdn.example.jp/absolute/seg-002.vtt',
    ]);
  });

  it('marks a live playlist without ENDLIST as incomplete', () => {
    const playlist = parseMediaPlaylist('#EXTM3U\n#EXT-X-MEDIA-SEQUENCE:42\n#EXTINF:4.0,\ns.vtt\n', MASTER_URL);
    expect(playlist.complete).toBe(false);
    expect(playlist.mediaSequence).toBe(42);
  });
});
