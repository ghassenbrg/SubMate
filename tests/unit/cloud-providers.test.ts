import { afterEach, describe, expect, it, vi } from 'vitest';
import { listModels, sendChat } from '../../src/translation/cloud/openai-compatible';
import {
  CLOUD_PROVIDERS,
  cloudProvider,
  detectProviderFromKey,
  normalizeBaseUrl,
  originPattern,
  resolveEndpoint,
} from '../../src/translation/cloud/providers';
import { CloudVendorError } from '../../src/translation/cloud/vendor';
import { validateSettings } from '../../src/settings/schema';
import { defaultSettings } from '../../src/settings/defaults';

const apiKey = 'AIzaTestKey1234567890abcdef';

afterEach(() => vi.unstubAllGlobals());

describe('cloud providers', () => {
  it('gives every preset an endpoint and a default model, and only custom neither', () => {
    for (const provider of CLOUD_PROVIDERS) {
      const custom = provider.id === 'custom';
      expect(Boolean(provider.baseUrl), provider.id).toBe(!custom);
      expect(Boolean(provider.defaultModel), provider.id).toBe(!custom);
      if (provider.baseUrl) expect(normalizeBaseUrl(provider.baseUrl)).toBe(provider.baseUrl);
    }
  });

  it('recognizes keys that belong to one provider only', () => {
    expect(detectProviderFromKey(apiKey)?.id).toBe('gemini');
    expect(detectProviderFromKey('sk-ant-api03-abcdefghijklmnopqrstuvwxyz')?.id).toBe('anthropic');
    expect(detectProviderFromKey('sk-or-v1-abcdefghijklmnopqrstuvwxyz')?.id).toBe('openrouter');
    expect(detectProviderFromKey('sk-proj-abcdefghijklmnopqrstuvwxyz')?.id).toBe('openai');
    expect(detectProviderFromKey('gsk_abcdefghijklmnopqrstuvwxyz')?.id).toBe('groq');
    // Plain sk- keys are shared by many providers and gateways.
    expect(detectProviderFromKey('sk-abcdefghijklmnopqrstuvwxyz0123')).toBeUndefined();
  });

  it('accepts HTTPS anywhere and HTTP only on this machine', () => {
    expect(normalizeBaseUrl('https://llm.example.com/v1/')).toBe('https://llm.example.com/v1');
    expect(normalizeBaseUrl('http://localhost:11434/v1')).toBe('http://localhost:11434/v1');
    expect(normalizeBaseUrl('http://127.0.0.1:1234/v1')).toBe('http://127.0.0.1:1234/v1');
    expect(normalizeBaseUrl('http://llm.example.com/v1')).toBeUndefined();
    expect(normalizeBaseUrl('https://user:pass@llm.example.com/v1')).toBeUndefined();
    expect(normalizeBaseUrl('https://llm.example.com/v1?key=secret')).toBeUndefined();
    expect(normalizeBaseUrl('not a url')).toBeUndefined();
  });

  it('never lets a stale custom URL redirect a preset', () => {
    const endpoint = resolveEndpoint({ cloudVendor: 'openai', cloudModel: '', cloudBaseUrl: 'https://evil.example' });
    expect(endpoint?.baseUrl).toBe(cloudProvider('openai').baseUrl);
    expect(endpoint?.model).toBe(cloudProvider('openai').defaultModel);
  });

  it('requires a base URL and a model for custom', () => {
    expect(resolveEndpoint({ cloudVendor: 'custom', cloudModel: 'llama3.3:70b', cloudBaseUrl: '' })).toBeUndefined();
    expect(resolveEndpoint({ cloudVendor: 'custom', cloudModel: '', cloudBaseUrl: 'http://localhost:11434/v1' })).toBeUndefined();
    expect(resolveEndpoint({ cloudVendor: 'custom', cloudModel: 'llama3.3:70b', cloudBaseUrl: 'http://localhost:11434/v1' }))
      .toMatchObject({ baseUrl: 'http://localhost:11434/v1', model: 'llama3.3:70b' });
  });

  it('asks for a host permission without a port, which match patterns cannot carry', () => {
    expect(originPattern('http://localhost:11434/v1')).toBe('http://localhost/*');
    expect(originPattern('https://api.openai.com/v1')).toBe('https://api.openai.com/*');
  });

  it('keeps real model ids through settings validation and drops unknown providers', () => {
    const settings = validateSettings({
      ...defaultSettings(),
      cloudVendor: 'nope',
      cloudModel: 'openai/gpt-oss-20b',
      cloudBaseUrl: 'http://example.com',
    });
    expect(settings.cloudVendor).toBe('gemini');
    expect(settings.cloudModel).toBe('openai/gpt-oss-20b');
    expect(settings.cloudBaseUrl).toBe('');
  });
});

describe('OpenAI-compatible client', () => {
  const endpoint = resolveEndpoint({ cloudVendor: 'gemini', cloudModel: '', cloudBaseUrl: '' })!;

  const respond = (status: number, body: string) => {
    const fetch = vi.fn(async (_url: string, _init?: RequestInit) => new Response(body, { status }));
    vi.stubGlobal('fetch', fetch);
    return fetch;
  };

  const failure = async (): Promise<CloudVendorError> => {
    const error = await sendChat({ endpoint, apiKey, prompt: { system: 's', user: 'x' } }).catch((caught: unknown) => caught);
    expect(error).toBeInstanceOf(CloudVendorError);
    return error as CloudVendorError;
  };

  it('sends the key as a bearer header and reads the first choice', async () => {
    const fetch = respond(200, JSON.stringify({ choices: [{ message: { content: '{"c1":"A"}' } }] }));
    expect(await sendChat({ endpoint, apiKey, prompt: { system: 's', user: 'x' } })).toBe('{"c1":"A"}');
    const [url, init] = fetch.mock.calls[0]!;
    expect(url).toBe(`${endpoint.baseUrl}/chat/completions`);
    expect(url).not.toContain(apiKey);
    expect((init?.headers as Record<string, string>).authorization).toBe(`Bearer ${apiKey}`);
    const body = JSON.parse(String(init?.body));
    expect(body).toMatchObject({ model: endpoint.model, response_format: { type: 'json_object' } });
    expect(body).not.toHaveProperty('temperature');
  });

  it('omits JSON mode and the key where a provider has none', async () => {
    const fetch = respond(200, JSON.stringify({ choices: [{ message: { content: [{ type: 'text', text: 'ok' }] } }] }));
    const local = resolveEndpoint({ cloudVendor: 'custom', cloudModel: 'llama3', cloudBaseUrl: 'http://localhost:11434/v1' })!;
    expect(await sendChat({ endpoint: local, apiKey: '', prompt: { system: 's', user: 'x' } })).toBe('ok');
    const init = fetch.mock.calls[0]![1];
    expect(init?.headers).not.toHaveProperty('authorization');
    expect(JSON.parse(String(init?.body))).not.toHaveProperty('response_format');
  });

  it('reports an invalid key, even when sent as a 400', async () => {
    respond(400, JSON.stringify({ error: { message: 'API key not valid. Please pass a valid API key.' } }));
    const error = await failure();
    expect(error.reason).toBe('auth');
    expect(error.retryable).toBe(false);
  });

  it('reports a retired or unknown model', async () => {
    respond(404, JSON.stringify({ error: { message: 'models/gemini-2.0-flash is not found' } }));
    const error = await failure();
    expect(error.reason).toBe('model');
    expect(error.retryable).toBe(false);
  });

  it('reports an exhausted quota as retryable', async () => {
    respond(429, JSON.stringify({ error: { message: 'quota' } }));
    const error = await failure();
    expect(error.reason).toBe('quota');
    expect(error.retryable).toBe(true);
  });

  it('reports an unreachable server', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => { throw new TypeError('Failed to fetch'); }));
    expect((await failure()).reason).toBe('network');
  });

  it('never echoes the key back in the message', async () => {
    respond(401, `bad key ${apiKey}`);
    expect((await failure()).message).not.toContain(apiKey);
  });

  it('lists model ids, stripping Gemini-style prefixes', async () => {
    respond(200, JSON.stringify({ data: [{ id: 'models/b' }, { id: 'a' }, { id: 'a' }, { id: 7 }] }));
    expect(await listModels(endpoint, apiKey)).toEqual(['a', 'b']);
  });
});
