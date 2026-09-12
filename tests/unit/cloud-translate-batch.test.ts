import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  apiKey: 'test-key-1234567890',
  sends: [] as string[],
  responder: (() => '{}') as (prompt: string, attempt: number) => string,
}));

vi.mock('../../src/translation/cloud/credentials', () => ({
  loadCloudApiKey: async () => mocks.apiKey,
}));

vi.mock('../../src/translation/cloud/gemini', () => ({
  cloudVendor: () => ({
    id: 'gemini',
    label: 'Google Gemini',
    defaultModel: 'test-model',
    apiHost: 'https://example.test/*',
    send: async ({ prompt }: { prompt: string }) => {
      mocks.sends.push(prompt);
      return mocks.responder(prompt, mocks.sends.length);
    },
  }),
}));

import { translateBatch } from '../../src/background/translate-batch';

const cues = [
  { id: 'c1', text: 'どうしたの？' },
  { id: 'c2', text: '何でもない。' },
  { id: 'c3', text: '行こう。' },
];

const request = (overrides = {}) => ({
  type: 'TRANSLATE_BATCH' as const,
  vendor: 'gemini',
  model: 'test-model',
  sourceLanguage: 'ja',
  targetLanguage: 'en',
  cues,
  ...overrides,
});

beforeEach(() => {
  mocks.apiKey = 'test-key-1234567890';
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
    mocks.apiKey = '';
    await expect(translateBatch(request())).rejects.toThrow(/API key/);
    expect(mocks.sends).toHaveLength(0);
  });

  it('returns nothing for an empty batch without calling the provider', async () => {
    const result = await translateBatch(request({ cues: [] }));
    expect(result.translations).toEqual([]);
    expect(mocks.sends).toHaveLength(0);
  });
});
