/**
 * Why a cloud request failed, in terms the user can act on. The raw provider
 * message is kept for debugging, but only this crosses into the UI.
 */
export type CloudFailureReason = 'auth' | 'model' | 'quota' | 'permission' | 'network' | 'untranslated' | 'other';

export class CloudVendorError extends Error {
  constructor(
    message: string,
    readonly status?: number,
    readonly retryable = false,
    readonly reason: CloudFailureReason = 'other',
  ) {
    super(message);
    this.name = 'CloudVendorError';
  }
}

/**
 * Removes anything key-shaped from a provider message before it can reach a
 * log, a diagnostics panel or the UI.
 */
export const redact = (value: string, apiKey?: string): string => {
  let output = value;
  if (apiKey && apiKey.length >= 8) output = output.replaceAll(apiKey, '[redacted]');
  return output
    .replaceAll(/\b(?:AIza|sk-|key-|gsk_|xai-)[A-Za-z0-9_-]{8,}/g, '[redacted]')
    .replaceAll(/([?&](?:key|api_key|apikey)=)[^&\s]+/gi, '$1[redacted]')
    .slice(0, 300);
};
