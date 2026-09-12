import { describe, expect, it } from 'vitest';
import {
  buildPrompt,
  contextFrom,
  extractJsonObject,
  reconcileBatch,
  type BatchCue,
} from '../../src/translation/cloud/batch';
import { redact } from '../../src/translation/cloud/vendor';

const cues: BatchCue[] = [
  { id: 'c000001', text: 'どうしたの？' },
  { id: 'c000002', text: '何でもない。' },
  { id: 'c000003', text: '♪～' },
];

describe('prompt construction', () => {
  it('sends cues keyed by id so ordering carries no meaning', () => {
    const prompt = buildPrompt({ sourceLanguage: 'ja', targetLanguage: 'en', cues });
    for (const cue of cues) expect(prompt).toContain(cue.id);
    expect(prompt).toContain('ja');
    expect(prompt).toContain('en');
  });

  it('includes continuity context only when supplied', () => {
    expect(buildPrompt({ sourceLanguage: 'ja', targetLanguage: 'en', cues })).not.toContain('Preceding dialogue');
    const withContext = buildPrompt({
      sourceLanguage: 'ja', targetLanguage: 'en', cues, previousContext: 'あ -> Ah',
    });
    expect(withContext).toContain('Preceding dialogue');
    expect(withContext).toContain('あ -> Ah');
  });
});

describe('response extraction', () => {
  it('unwraps a fenced JSON block', () => {
    expect(extractJsonObject('```json\n{"a":"b"}\n```')).toBe('{"a":"b"}');
    expect(extractJsonObject('```\n{"a":"b"}\n```')).toBe('{"a":"b"}');
  });

  it('ignores prose surrounding the object', () => {
    expect(extractJsonObject('Sure! Here you go:\n{"a":"b"}\nHope that helps.')).toBe('{"a":"b"}');
  });

  it('keeps a top-level array intact, brackets and all', () => {
    // Slicing from the first brace to the last would strip the brackets and
    // leave something that no longer parses.
    expect(extractJsonObject('```json\n[{"id":"a","text":"b"}]\n```')).toBe('[{"id":"a","text":"b"}]');
    expect(extractJsonObject('Here:\n[{"id":"a","text":"b"}]')).toBe('[{"id":"a","text":"b"}]');
  });

  it('returns nothing when there is no object at all', () => {
    expect(extractJsonObject('I cannot help with that.')).toBeUndefined();
    expect(extractJsonObject('')).toBeUndefined();
  });
});

describe('batch reconciliation', () => {
  it('maps a well-formed response by id', () => {
    const { translations, missing } = reconcileBatch(
      JSON.stringify({ c000001: "What's wrong?", c000002: "It's nothing.", c000003: '♪～' }),
      cues,
    );
    expect(translations.get('c000001')).toBe("What's wrong?");
    expect(missing).toEqual([]);
  });

  it('reports ids the model dropped rather than silently shifting text', () => {
    // Dropping a line is the classic failure; ordering must never be used to
    // realign, or every later cue would be attributed to the wrong subtitle.
    const { translations, missing } = reconcileBatch(
      JSON.stringify({ c000001: "What's wrong?", c000003: '♪～' }),
      cues,
    );
    expect(missing).toEqual(['c000002']);
    expect(translations.has('c000002')).toBe(false);
  });

  it('discards ids that were never requested', () => {
    const { translations } = reconcileBatch(
      JSON.stringify({ c000001: 'ok', c999999: 'hallucinated' }),
      cues,
    );
    expect(translations.has('c999999')).toBe(false);
  });

  it('accepts the array-of-objects shape models sometimes return', () => {
    const { translations, missing } = reconcileBatch(
      JSON.stringify([
        { id: 'c000001', text: "What's wrong?" },
        { id: 'c000002', text: "It's nothing." },
        { id: 'c000003', text: '♪～' },
      ]),
      cues,
    );
    expect(translations.get('c000002')).toBe("It's nothing.");
    expect(missing).toEqual([]);
  });

  it('accepts nested {text} values', () => {
    const { translations } = reconcileBatch(JSON.stringify({ c000001: { text: 'hi' } }), cues);
    expect(translations.get('c000001')).toBe('hi');
  });

  it('treats an empty translation for real dialogue as missing', () => {
    const { missing } = reconcileBatch(JSON.stringify({ c000001: '   ', c000002: 'x', c000003: 'y' }), cues);
    expect(missing).toEqual(['c000001']);
  });

  it('never marks a blank source cue as missing', () => {
    const blank: BatchCue[] = [{ id: 'b1', text: '  ' }];
    const { translations, missing } = reconcileBatch('{}', blank);
    expect(missing).toEqual([]);
    expect(translations.get('b1')).toBe('');
  });

  it('survives malformed or truncated JSON without throwing', () => {
    for (const bad of ['{"c000001": "unterminated', 'not json at all', '']) {
      expect(() => reconcileBatch(bad, cues)).not.toThrow();
      expect(reconcileBatch(bad, cues).missing.length).toBeGreaterThan(0);
    }
  });
});

describe('continuity context', () => {
  it('summarises the tail of a finished batch', () => {
    const translations = new Map([['c000001', 'A'], ['c000002', 'B'], ['c000003', 'C']]);
    const context = contextFrom(cues, translations, 2);
    expect(context).toContain('B');
    expect(context).toContain('C');
    expect(context).not.toContain('A');
  });
});

describe('secret redaction', () => {
  it('removes an exact key, key-shaped tokens and key query parameters', () => {
    expect(redact('failed for AIzaSyEXAMPLEKEY1234567890')).toContain('[redacted]');
    expect(redact('https://api.test/x?key=SECRETVALUE&a=1')).not.toContain('SECRETVALUE');
    expect(redact('boom with mykey123456', 'mykey123456')).not.toContain('mykey123456');
  });

  it('keeps the surrounding message useful', () => {
    expect(redact('Translation service returned 429: rate limited')).toContain('429');
  });
});
