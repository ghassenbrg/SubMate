import { withRetry } from '../core/retry';
import { loadSettings } from '../settings/store';
import {
  buildPrompt,
  contextFrom,
  echoedIds,
  reconcileBatch,
  type BatchCue,
} from '../translation/cloud/batch';
import { listModels, sendChat } from '../translation/cloud/openai-compatible';
import { cloudSetup, type CloudSetupIssue } from '../translation/cloud/readiness';
import { CloudVendorError, redact } from '../translation/cloud/vendor';

export interface TranslateBatchRequest {
  type: 'TRANSLATE_BATCH';
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
  issue?: CloudSetupIssue;
}

const MAX_CUES_PER_BATCH = 200;

const SETUP_ERRORS: Record<CloudSetupIssue, CloudVendorError> = {
  endpoint: new CloudVendorError('Cloud translation is not fully configured', undefined, false, 'other'),
  key: new CloudVendorError('No API key is configured for cloud translation', undefined, false, 'other'),
  permission: new CloudVendorError('SubMate has no permission to reach this provider', undefined, false, 'permission'),
};

/**
 * The provider, endpoint and key always come from storage, never from the
 * message: a content script runs beside a streaming page, and must not be able
 * to point a saved key at a host of its choosing.
 */
async function configured() {
  const setup = await cloudSetup(await loadSettings());
  if (setup.issue || !setup.endpoint) throw SETUP_ERRORS[setup.issue ?? 'endpoint'];
  return { endpoint: setup.endpoint, apiKey: setup.apiKey };
}

export async function translateAvailability(): Promise<TranslateAvailabilityResult> {
  const { issue } = await cloudSetup(await loadSettings());
  return issue ? { configured: false, issue } : { configured: true };
}

/** Model suggestions for the options page. */
export async function translateModels(): Promise<string[]> {
  const { endpoint, apiKey } = await configured();
  return listModels(endpoint, apiKey).catch((error: unknown) => {
    throw new Error(redact(error instanceof Error ? error.message : 'Could not list models', apiKey));
  });
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
  const { endpoint, apiKey } = await configured();

  const send = async (batch: BatchCue[], context?: string): Promise<string> =>
    withRetry(
      () => sendChat({
        endpoint,
        apiKey,
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
        shouldRetry: (error) => !(error instanceof CloudVendorError) || error.retryable,
      },
    ).catch((error: unknown) => {
      const message = redact(error instanceof Error ? error.message : 'Translation request failed', apiKey);
      // The reason survives redaction so the UI can say what to fix.
      if (error instanceof CloudVendorError) {
        throw new CloudVendorError(message, error.status, error.retryable, error.reason);
      }
      throw new Error(message);
    });

  const echoed = (map: Map<string, string>, batch: BatchCue[]) =>
    echoedIds(batch, map, request.sourceLanguage, request.targetLanguage);

  const first = reconcileBatch(await send(cues, request.previousContext), cues);
  let { translations } = first;

  // One targeted repair pass for whatever the model dropped, merged or handed
  // back untranslated. Asking only for those lines is both cheaper and
  // markedly more reliable than repeating the whole batch.
  const retryIds = new Set([...first.missing, ...echoed(translations, cues)]);
  if (retryIds.size) {
    const retryCues = cues.filter((cue) => retryIds.has(cue.id));
    try {
      const repaired = reconcileBatch(await send(retryCues, request.previousContext), retryCues);
      translations = new Map([...translations, ...repaired.translations]);
    } catch {
      // Keep whatever the first pass produced; unresolved lines fall back to
      // their original text at render time.
    }
  }

  // Still untranslated after the repair: a model that returns most of a batch
  // unchanged is not translating, and caching its output would pin the
  // original text on screen for this episode. Fail so the user can switch.
  const stillEchoed = echoed(translations, cues);
  const translatable = cues.filter((cue) => /\p{L}{2,}/u.test(cue.text)).length;
  if (translatable && stillEchoed.length > translatable / 2) {
    throw new CloudVendorError(
      `The model returned ${stillEchoed.length} of ${translatable} lines untranslated`,
      undefined,
      false,
      'untranslated',
    );
  }
  // The odd leftover is blanked, so the renderer shows the original once
  // rather than the same line twice.
  for (const id of stillEchoed) translations.set(id, '');

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
