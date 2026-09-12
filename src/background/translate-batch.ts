import { withRetry } from '../core/retry';
import {
  buildPrompt,
  contextFrom,
  reconcileBatch,
  type BatchCue,
} from '../translation/cloud/batch';
import { cloudVendor } from '../translation/cloud/gemini';
import { loadCloudApiKey } from '../translation/cloud/credentials';
import { CloudVendorError, redact } from '../translation/cloud/vendor';

export interface TranslateBatchRequest {
  type: 'TRANSLATE_BATCH';
  vendor: string;
  model: string;
  sourceLanguage: string;
  targetLanguage: string;
  cues: BatchCue[];
  previousContext?: string;
}

export interface TranslateBatchResult {
  translations: Array<{ id: string; text: string }>;
  /** Ids the model never returned usable text for, after the repair attempt. */
  unresolved: string[];
  /** Continuity context for the next batch. */
  context: string;
}

export interface TranslateAvailabilityResult {
  configured: boolean;
  vendor: string;
  model: string;
}

const MAX_CUES_PER_BATCH = 200;

export async function translateAvailability(vendor: string, model: string): Promise<TranslateAvailabilityResult> {
  const chosen = cloudVendor(vendor);
  return {
    configured: (await loadCloudApiKey()).length > 0,
    vendor: chosen.id,
    model: model || chosen.defaultModel,
  };
}

/**
 * Translates one batch in the background worker.
 *
 * The worker is the only context that ever sees the API key. Batches are kept
 * small and each message handles exactly one, so an MV3 worker shutdown costs a
 * single batch rather than an entire episode.
 */
export async function translateBatch(request: TranslateBatchRequest): Promise<TranslateBatchResult> {
  if (!Array.isArray(request.cues) || !request.cues.length) {
    return { translations: [], unresolved: [], context: '' };
  }
  const cues = request.cues.slice(0, MAX_CUES_PER_BATCH);
  const apiKey = await loadCloudApiKey();
  if (!apiKey) throw new Error('No API key is configured for cloud translation');
  const vendor = cloudVendor(request.vendor);
  const model = request.model || vendor.defaultModel;

  const send = async (batch: BatchCue[], context?: string): Promise<string> =>
    withRetry(
      () => vendor.send({
        apiKey,
        model,
        prompt: buildPrompt({
          sourceLanguage: request.sourceLanguage,
          targetLanguage: request.targetLanguage,
          cues: batch,
          ...(context ? { previousContext: context } : {}),
        }),
      }),
      {
        // Only rate limits and server faults are worth waiting out; a bad key
        // or model fails the same way however many times it is asked.
        onRetry: () => undefined,
      },
    ).catch((error: unknown) => {
      if (error instanceof CloudVendorError && !error.retryable) throw new Error(redact(error.message, apiKey));
      throw new Error(redact(error instanceof Error ? error.message : 'Translation request failed', apiKey));
    });

  const first = reconcileBatch(await send(cues, request.previousContext), cues);
  let { translations } = first;

  // One targeted repair pass for whatever the model dropped or merged. Asking
  // only for the missing lines is both cheaper and markedly more reliable than
  // repeating the whole batch.
  if (first.missing.length) {
    const retryCues = cues.filter((cue) => first.missing.includes(cue.id));
    try {
      const repaired = reconcileBatch(await send(retryCues, request.previousContext), retryCues);
      translations = new Map([...translations, ...repaired.translations]);
    } catch {
      // Keep whatever the first pass produced; unresolved lines fall back to
      // their original text at render time.
    }
  }

  const unresolved = cues
    .filter((cue) => cue.text.trim() && !(translations.get(cue.id) ?? '').trim())
    .map((cue) => cue.id);

  return {
    // Every requested id is present, so downstream validation stays exact.
    translations: cues.map((cue) => ({ id: cue.id, text: translations.get(cue.id) ?? '' })),
    unresolved,
    context: contextFrom(cues, translations),
  };
}
