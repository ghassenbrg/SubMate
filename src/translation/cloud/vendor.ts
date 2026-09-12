/**
 * A cloud translation vendor.
 *
 * Vendors are kept behind this interface for the same reason platforms are kept
 * behind adapters: adding DeepL or another provider should be a new file, not a
 * change to the translation pipeline.
 */
export interface CloudVendorRequest {
  apiKey: string;
  model: string;
  prompt: string;
  signal?: AbortSignal;
}

export interface CloudVendor {
  readonly id: string;
  readonly label: string;
  readonly defaultModel: string;
  /** Host added to `host_permissions`; used to document required access. */
  readonly apiHost: string;
  /** Sends one batch and returns the model's raw text response. */
  send(request: CloudVendorRequest): Promise<string>;
}

export class CloudVendorError extends Error {
  constructor(message: string, readonly status?: number, readonly retryable = false) {
    super(message);
    this.name = 'CloudVendorError';
  }
}

/**
 * Removes anything key-shaped from a vendor message before it can reach a log,
 * a diagnostics panel or the UI.
 */
export const redact = (value: string, apiKey?: string): string => {
  let output = value;
  if (apiKey && apiKey.length >= 8) output = output.replaceAll(apiKey, '[redacted]');
  return output
    .replaceAll(/\b(?:AIza|sk-|key-)[A-Za-z0-9_-]{8,}/g, '[redacted]')
    .replaceAll(/([?&](?:key|api_key|apikey)=)[^&\s]+/gi, '$1[redacted]')
    .slice(0, 300);
};
