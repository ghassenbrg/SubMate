import type { BatchPrompt } from './batch';
import type { CloudEndpoint } from './providers';
import { CloudVendorError, redact, type CloudFailureReason } from './vendor';

export interface ChatRequest {
  endpoint: CloudEndpoint;
  apiKey: string;
  prompt: BatchPrompt;
  signal?: AbortSignal;
}

/**
 * Maps a failed response to something the user can fix. Some providers report
 * a bad key as a 400 rather than a 401, so the body has to be consulted too.
 */
const failureReason = (status: number, body: string): CloudFailureReason => {
  if (status === 401 || status === 403 || /API_KEY_INVALID|API key not valid|invalid.{0,12}api.?key/i.test(body)) {
    return 'auth';
  }
  if (status === 404) return 'model';
  if (status === 429) return 'quota';
  return 'other';
};

const headersFor = (endpoint: CloudEndpoint, apiKey: string): Record<string, string> => ({
  ...endpoint.provider.headers,
  // The key travels in a header, never the URL, so it cannot be logged by a
  // proxy or end up in history.
  ...(apiKey ? { authorization: `Bearer ${apiKey}` } : {}),
});

async function request(url: string, init: RequestInit, apiKey: string): Promise<Response> {
  let response: Response;
  try {
    response = await fetch(url, { ...init, credentials: 'omit', referrerPolicy: 'no-referrer' });
  } catch (error) {
    if (error instanceof DOMException && error.name === 'AbortError') throw error;
    throw new CloudVendorError('Could not reach the translation service', undefined, true, 'network');
  }
  if (!response.ok) {
    const raw = await response.text().catch(() => '');
    const detail = redact(raw, apiKey);
    // 429 and 5xx are worth retrying; 4xx generally means a bad key or model.
    const retryable = response.status === 429 || response.status >= 500;
    throw new CloudVendorError(
      `Translation service returned ${response.status}${detail ? `: ${detail}` : ''}`,
      response.status,
      retryable,
      failureReason(response.status, raw),
    );
  }
  return response;
}

type ContentPart = { type?: string; text?: string };

/** Sends one prompt and returns the model's raw text. */
export async function sendChat({ endpoint, apiKey, prompt, signal }: ChatRequest): Promise<string> {
  const response = await request(`${endpoint.baseUrl}/chat/completions`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', ...headersFor(endpoint, apiKey) },
    body: JSON.stringify({
      model: endpoint.model,
      messages: [
        { role: 'system', content: prompt.system },
        { role: 'user', content: prompt.user },
      ],
      // No temperature: reasoning models reject anything but the default.
      ...(endpoint.provider.jsonMode ? { response_format: { type: 'json_object' } } : {}),
      ...endpoint.provider.extraBody,
    }),
    ...(signal ? { signal } : {}),
  }, apiKey);

  const body = await response.json().catch(() => undefined) as
    | { choices?: Array<{ message?: { content?: string | ContentPart[] | null } }> }
    | undefined;
  const content = body?.choices?.[0]?.message?.content;
  const text = Array.isArray(content)
    ? content.map((part) => (part.type === undefined || part.type === 'text' ? part.text ?? '' : '')).join('')
    : content ?? '';
  if (!text.trim()) throw new CloudVendorError('Translation service returned an empty response', undefined, true);
  return text;
}

/**
 * Model ids the endpoint offers, for the options page's suggestions. Best
 * effort: not every server implements the listing, and an empty list is fine.
 */
export async function listModels(endpoint: CloudEndpoint, apiKey: string): Promise<string[]> {
  const response = await request(`${endpoint.baseUrl}/models`, {
    headers: headersFor(endpoint, apiKey),
  }, apiKey);
  const body = await response.json().catch(() => undefined) as { data?: Array<{ id?: unknown }> } | undefined;
  const ids = (body?.data ?? [])
    .map((model) => (typeof model.id === 'string' ? model.id.replace(/^models\//, '') : ''))
    .filter((id) => /^[\w.:/@-]{1,128}$/.test(id));
  return [...new Set(ids)].sort().slice(0, 500);
}
