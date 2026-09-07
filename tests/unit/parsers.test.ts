import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { parseSubtitle } from '../../src/subtitles/parser';
import { parseTtml } from '../../src/subtitles/ttml-parser';
import { parseSrt, parseVtt } from '../../src/subtitles/vtt-parser';
import { parseTimeExpression } from '../../src/subtitles/time';

const fixture = (name: string) => readFileSync(resolve('tests/fixtures', name), 'utf8');

describe('subtitle parsers', () => {
  it('parses Netflix tick-based and clock TTML with multiline entities and overlap', () => {
    const cues = parseTtml(fixture('sample.ttml'));
    expect(cues).toHaveLength(3);
    expect(cues[0]).toEqual({ id: 'first', startMs: 12410, endMs: 14821, sourceText: 'Hello & goodbye\nagain' });
    expect(cues[1]?.startMs).toBe(14500);
    expect(cues[2]?.sourceText).toBe('');
    expect(cues[2]?.endMs).toBe(18505);
  });

  it('supports time precision, offsets, frames, and ticks', () => {
    expect(parseTimeExpression('00:01:02.345')).toBe(62345);
    expect(parseTimeExpression('00:00:01:15', { frameRate: 30 })).toBe(1500);
    expect(parseTimeExpression('1250ms')).toBe(1250);
    expect(parseTimeExpression('15f', { frameRate: 30 })).toBe(500);
    expect(parseTimeExpression('10000000t')).toBe(1000);
  });

  it('parses WebVTT markup as plain text and preserves lines', () => {
    const cues = parseVtt(fixture('sample.vtt'));
    expect(cues.map((cue) => cue.id)).toEqual(['alpha', 'c000002']);
    expect(cues[0]?.sourceText).toBe('Hello & world');
    expect(cues[1]?.sourceText).toBe('Second line\ncontinues');
  });

  it('parses SRT and auto-detects formats', () => {
    const input = '1\n00:00:01,250 --> 00:00:02,750\nBonjour\n\n';
    expect(parseSrt(input)[0]?.startMs).toBe(1250);
    expect(parseSubtitle(input, 'srt')[0]?.sourceText).toBe('Bonjour');
    expect(parseSubtitle(fixture('sample.vtt'), 'webvtt-lssdh-ios8')).toHaveLength(2);
  });

  it('rejects malformed or empty subtitle input', () => {
    expect(() => parseTtml('<tt><p>broken')).toThrow();
    expect(() => parseVtt('WEBVTT\n\nNOTE no cues')).toThrow();
  });
});
