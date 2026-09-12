import { describe, expect, it } from 'vitest';
import { exportSource, importTranslation, sourcePackage } from '../../src/import-export/formats';
import { validateTranslationResult } from '../../src/subtitles/validation';
import { sourceTrack } from './validation.test';

describe('manual import/export', () => {
  it('exports canonical JSON without translation-controlled timing', () => {
    const value = JSON.parse(exportSource(sourceTrack(), 'json'));
    expect(value).toEqual(sourcePackage(sourceTrack()));
    expect(value.cues[0]).toEqual({ id: 'c000001', startMs: 1000, endMs: 2000, text: 'Hallo' });
  });

  it('round-trips SRT and VTT using source timing', () => {
    const source = sourceTrack();
    const srt = exportSource(source, 'srt').replace('Hallo', 'Hello').replace('Welt', 'World');
    const vtt = exportSource(source, 'vtt').replace('Hallo', 'Hello').replace('Welt', 'World');
    expect(importTranslation(srt, 'translated.srt', source, 'en').translations[1]?.text).toBe('World');
    expect(importTranslation(vtt, 'translated.vtt', source, 'en').translations[0]?.text).toBe('Hello');
  });

  it('keeps malicious markup as inert text data', () => {
    const source = sourceTrack();
    const input = JSON.stringify({ schemaVersion: 1, kind: 'submate-translation', sourceHash: source.sourceHash, sourceLanguage: 'de', targetLanguage: 'ar', translations: [
      { id: 'c000001', text: '<img src=x onerror=alert(1)>' }, { id: 'c000002', text: '<script>alert(1)</script>' },
    ] });
    const result = importTranslation(input, 'safe.json', source, 'en');
    validateTranslationResult(source, result);
    expect(result.translations[0]?.text).toContain('onerror');
  });

  it('rejects wrong hashes, duplicate IDs, partial files, and ambiguous timing', () => {
    const source = sourceTrack();
    const wrong = JSON.stringify({ schemaVersion: 1, kind: 'submate-translation', sourceHash: 'wrong', sourceLanguage: 'de', targetLanguage: 'en', translations: [] });
    expect(() => importTranslation(wrong, 'wrong.json', source, 'en')).toThrow();
    const duplicate = JSON.stringify({ schemaVersion: 1, kind: 'submate-translation', sourceHash: source.sourceHash, sourceLanguage: 'de', targetLanguage: 'en', translations: [
      { id: 'c000001', text: 'a' }, { id: 'c000001', text: 'b' },
    ] });
    expect(() => validateTranslationResult(source, importTranslation(duplicate, 'duplicate.json', source, 'en'))).toThrow();
    expect(() => importTranslation('1\n00:00:01,000 --> 00:00:02,000\nOnly one\n', 'partial.srt', source, 'en')).toThrow();
    expect(() => importTranslation('1\n00:00:09,000 --> 00:00:10,000\nA\n\n2\n00:00:11,000 --> 00:00:12,000\nB\n', 'wrong.srt', source, 'en')).toThrow();
  });
});
