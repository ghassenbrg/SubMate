import { CloudVendorError, redact, type CloudVendor, type CloudVendorRequest } from './vendor';

const HOST = 'https://generativelanguage.googleapis.com';

/**
 * Google Gemini via the Generative Language API.
 *
 * The key travels in the `x-goog-api-key` header rather than the query string,
 * so it cannot end up in a URL that gets logged by a proxy or the browser.
 * JSON output is requested explicitly, which materially improves the odds of a
 * parseable, id-keyed response.
 */
export const geminiVendor: CloudVendor = {
  id: 'gemini',
  label: 'Google Gemini',
  defaultModel: 'gemini-2.0-flash',
  apiHost: `${HOST}/*`,

  async send({ apiKey, model, prompt, signal }: CloudVendorRequest): Promise<string> {
    const safeModel = /^[A-Za-z0-9._-]{1,64}$/.test(model) ? model : geminiVendor.defaultModel;
    let response: Response;
    try {
      response = await fetch(`${HOST}/v1beta/models/${safeModel}:generateContent`, {
        method: 'POST',
        headers: { 'content-type': 'application/json', 'x-goog-api-key': apiKey },
        body: JSON.stringify({
          contents: [{ role: 'user', parts: [{ text: prompt }] }],
          generationConfig: {
            // Subtitles need fidelity, not invention.
            temperature: 0.2,
            responseMimeType: 'application/json',
          },
        }),
        ...(signal ? { signal } : {}),
      });
    } catch (error) {
      if (error instanceof DOMException && error.name === 'AbortError') throw error;
      throw new CloudVendorError('Could not reach the translation service', undefined, true);
    }

    if (!response.ok) {
      const detail = redact(await response.text().catch(() => ''), apiKey);
      // 429 and 5xx are worth retrying; 4xx generally means a bad key or model.
      const retryable = response.status === 429 || response.status >= 500;
      throw new CloudVendorError(
        `Translation service returned ${response.status}${detail ? `: ${detail}` : ''}`,
        response.status,
        retryable,
      );
    }

    const body = await response.json().catch(() => undefined) as
      | { candidates?: Array<{ content?: { parts?: Array<{ text?: string }> } }> }
      | undefined;
    const text = body?.candidates?.[0]?.content?.parts?.map((part) => part.text ?? '').join('') ?? '';
    if (!text.trim()) throw new CloudVendorError('Translation service returned an empty response', undefined, true);
    return text;
  },
};

export const CLOUD_VENDORS = { gemini: geminiVendor } as const;

export type CloudVendorId = keyof typeof CLOUD_VENDORS;

export const cloudVendor = (id: string): CloudVendor => CLOUD_VENDORS[id as CloudVendorId] ?? geminiVendor;
