import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  apiKey: 'test-key-1234567890',
  issue: undefined as undefined | 'endpoint' | 'key' | 'permission',
  sends: [] as string[],
  responder: (() => '{}') as (prompt: string, attempt: number) => string,
}));

vi.mock('../../src/settings/store', () => ({
  loadSettings: async () => ({ cloudVendor: 'gemini', cloudModel: '', cloudBaseUrl: '' }),
}));

vi.mock('../../src/translation/cloud/readiness', () => ({
  cloudSetup: async () => (mocks.issue
    ? { issue: mocks.issue, apiKey: '' }
    : {
      apiKey: mocks.apiKey,
      endpoint: {
        provider: { id: 'gemini', label: 'Google Gemini', keyRequired: true, jsonMode: true },
        baseUrl: 'https://example.test/v1',
        model: 'test-model',
      },
    }),
}));

vi.mock('../../src/translation/cloud/openai-compatible', () => ({
  sendChat: async ({ prompt }: { prompt: { system: string; user: string } }) => {
    mocks.sends.push(prompt.user);
    return mocks.responder(prompt.user, mocks.sends.length);
  },
  listModels: async () => [],
}));

import { translateBatch } from '../../src/background/translate-batch';
import { CloudVendorError } from '../../src/translation/cloud/vendor';

const cues = [
  { id: 'c1', text: 'どうしたの？' },
  { id: 'c2', text: '何でもない。' },
  { id: 'c3', text: '行こう。' },
];

const request = (overrides = {}) => ({
  type: 'TRANSLATE_BATCH' as const,
  sourceLanguage: 'ja',
  targetLanguage: 'en',
  cues,
  ...overrides,
});

beforeEach(() => {
  mocks.apiKey = 'test-key-1234567890';
  mocks.issue = undefined;
  mocks.sends = [];
  mocks.responder = () => JSON.stringify({ c1: 'A', c2: 'B', c3: 'C' });
});

describe('background batch translation', () => {
  it('returns every requested id in order, so validation stays exact', async () => {
    const result = await translateBatch(request());
    expect(result.translations.map((t) => t.id)).toEqual(['c1', 'c2', 'c3']);
    expect(result.unresolved).toEqual([]);
    expect(mocks.sends).toHaveLength(1);
  });

  it('retries only the lines the model dropped', async () => {
    mocks.responder = (_prompt, attempt) =>
      attempt === 1
        ? JSON.stringify({ c1: 'A', c3: 'C' })
        : JSON.stringify({ c2: 'B' });
    const result = await translateBatch(request());
    expect(mocks.sends).toHaveLength(2);
    // The repair pass asks for the missing line and nothing else.
    expect(mocks.sends[1]).toContain('c2');
    expect(mocks.sends[1]).not.toContain('c1');
    expect(result.translations).toEqual([
      { id: 'c1', text: 'A' }, { id: 'c2', text: 'B' }, { id: 'c3', text: 'C' },
    ]);
    expect(result.unresolved).toEqual([]);
  });

  it('leaves a stubborn line blank rather than failing the episode', async () => {
    // Blank lines render as the original text, which beats losing the batch.
    mocks.responder = () => JSON.stringify({ c1: 'A', c3: 'C' });
    const result = await translateBatch(request());
    expect(result.unresolved).toEqual(['c2']);
    expect(result.translations.find((t) => t.id === 'c2')?.text).toBe('');
    expect(result.translations).toHaveLength(3);
  });

  it('asks again for lines handed back untranslated', async () => {
    mocks.responder = (_prompt, attempt) =>
      attempt === 1
        ? JSON.stringify({ c1: 'A', c2: '何でもない。', c3: 'C' })
        : JSON.stringify({ c2: 'B' });
    const result = await translateBatch(request());
    expect(mocks.sends).toHaveLength(2);
    expect(mocks.sends[1]).toContain('c2');
    expect(mocks.sends[1]).not.toContain('c1');
    expect(result.translations.find((t) => t.id === 'c2')?.text).toBe('B');
  });

  it('fails a batch the model keeps returning untranslated, instead of caching it', async () => {
    mocks.responder = (prompt) => JSON.stringify(JSON.parse(prompt.slice(prompt.indexOf('{'))));
    const error = await translateBatch(request()).catch((caught: unknown) => caught);
    expect(error).toBeInstanceOf(CloudVendorError);
    expect((error as CloudVendorError).reason).toBe('untranslated');
  });

  it('blanks a lone untranslated line so it is not shown twice', async () => {
    mocks.responder = () => JSON.stringify({ c1: 'A', c2: '何でもない。', c3: 'C' });
    const result = await translateBatch(request());
    expect(result.translations.find((t) => t.id === 'c2')?.text).toBe('');
    expect(result.unresolved).toEqual(['c2']);
  });

  it('never lets a hallucinated id into the result', async () => {
    mocks.responder = () => JSON.stringify({ c1: 'A', c2: 'B', c3: 'C', c999: 'ghost' });
    const result = await translateBatch(request());
    expect(result.translations.map((t) => t.id)).toEqual(['c1', 'c2', 'c3']);
  });

  it('tolerates a fenced response', async () => {
    mocks.responder = () => '```json\n{"c1":"A","c2":"B","c3":"C"}\n```';
    const result = await translateBatch(request());
    expect(result.unresolved).toEqual([]);
  });

  it('carries continuity context forward for the next batch', async () => {
    const result = await translateBatch(request());
    expect(result.context).toContain('C');
  });

  it('passes supplied context into the prompt', async () => {
    await translateBatch(request({ previousContext: 'prior -> line' }));
    expect(mocks.sends[0]).toContain('prior -> line');
  });

  it('refuses to run without a configured key', async () => {
    mocks.issue = 'key';
    await expect(translateBatch(request())).rejects.toThrow(/API key/);
    expect(mocks.sends).toHaveLength(0);
  });

  it('reports a missing host permission as fixable', async () => {
    mocks.issue = 'permission';
    const error = await translateBatch(request()).catch((caught: unknown) => caught);
    expect((error as CloudVendorError).reason).toBe('permission');
    expect(mocks.sends).toHaveLength(0);
  });

  it('fails at once on an error retrying cannot fix, keeping the reason', async () => {
    mocks.responder = () => {
      throw new CloudVendorError(`Translation service returned 404: ${mocks.apiKey}`, 404, false, 'model');
    };
    const error = await translateBatch(request()).catch((caught: unknown) => caught);
    expect(error).toBeInstanceOf(CloudVendorError);
    expect((error as CloudVendorError).reason).toBe('model');
    expect((error as CloudVendorError).message).not.toContain(mocks.apiKey);
    expect(mocks.sends).toHaveLength(1);
  });

  it('returns nothing for an empty batch without calling the provider', async () => {
    const result = await translateBatch(request({ cues: [] }));
    expect(result.translations).toEqual([]);
    expect(mocks.sends).toHaveLength(0);
  });
});
