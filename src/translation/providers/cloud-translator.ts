import { SubMateError, type SubMateErrorCode } from '../../shared-errors';
import type { TranslationRequest, TranslationResult } from '../../subtitles/models';
import { chunkCues } from '../chunker';
import { CLOUD_PROMPT_REVISION } from '../cloud/batch';
import { resolveEndpoint } from '../cloud/providers';
import type { CloudFailureReason } from '../cloud/vendor';
import type { TranslationProgress, TranslationProvider } from '../provider';
import type { SubMateSettings } from '../../settings/schema';
import type {
  TranslateAvailabilityResult,
  TranslateBatchResult,
} from '../../background/translate-batch';

/**
 * Cloud translation, executed in the background worker.
 *
 * This class never sees the API key: it only sends batches of subtitle text and
 * receives translations back. Larger batches than the on-device engine, because
 * a language model translates a run of dialogue more consistently than it
 * translates isolated lines.
 */
const BATCH = { maxCues: 60, maxCharacters: 6_000 } as const;

/** Failures the user can act on get their own code, and so their own message. */
const REASON_CODES: Partial<Record<CloudFailureReason, SubMateErrorCode>> = {
  auth: 'CLOUD_AUTH_FAILED',
  model: 'CLOUD_MODEL_UNAVAILABLE',
  quota: 'CLOUD_QUOTA_EXCEEDED',
  permission: 'CLOUD_PERMISSION_MISSING',
  network: 'CLOUD_UNREACHABLE',
  untranslated: 'CLOUD_UNTRANSLATED',
};

async function send<T>(message: Record<string, unknown>): Promise<T> {
  const response = await chrome.runtime.sendMessage(message);
  if (!response?.ok) {
    const detail = response?.error ?? 'Cloud translation request failed';
    const code = REASON_CODES[response?.reason as CloudFailureReason];
    throw code ? new SubMateError(code, detail) : new Error(detail);
  }
  return response.value as T;
}

export class CloudTranslatorProvider implements TranslationProvider {
  /** Provider is part of the id, so switching providers correctly misses cache. */
  readonly id: string;
  /** Model is the version, so changing model re-translates rather than
   *  serving output from a different model. */
  readonly version: string;

  constructor(settings: Pick<SubMateSettings, 'cloudVendor' | 'cloudModel' | 'cloudBaseUrl'>) {
    this.id = `cloud-${settings.cloudVendor}`;
    const endpoint = resolveEndpoint(settings);
    // Resolved rather than 'default', so a future change of default model
    // re-translates. A custom model name only means something on its own
    // server, so the host is part of the version too.
    // The prompt revision is part of it too: a prompt change changes output.
    this.version = !endpoint
      ? 'unconfigured'
      : `${endpoint.provider.baseUrl ? endpoint.model : `${endpoint.model}@${new URL(endpoint.baseUrl).host}`}#p${CLOUD_PROMPT_REVISION}`;
  }

  async availability(): Promise<'available' | 'downloadable' | 'unavailable'> {
    try {
      const result = await send<TranslateAvailabilityResult>({ type: 'TRANSLATE_AVAILABILITY' });
      return result.configured ? 'available' : 'unavailable';
    } catch {
      return 'unavailable';
    }
  }

  /** No user gesture is required; the key is configured ahead of time. */
  needsActivation(): boolean {
    return false;
  }

  async activate(): Promise<void> {
    const state = await this.availability();
    if (state !== 'available') {
      throw new SubMateError('TRANSLATOR_UNAVAILABLE', 'No API key is configured for cloud translation');
    }
  }

  async translate(
    input: TranslationRequest,
    onProgress?: (progress: TranslationProgress) => void,
    signal?: AbortSignal,
  ): Promise<TranslationResult> {
    const translations: Array<{ id: string; text: string }> = [];
    const chunks = chunkCues(input.cues, BATCH);
    let completed = 0;
    let context: string | undefined;
    let unresolved = 0;

    for (const chunk of chunks) {
      if (signal?.aborted) throw signal.reason ?? new DOMException('Aborted', 'AbortError');
      let result: TranslateBatchResult;
      try {
        result = await send<TranslateBatchResult>({
          type: 'TRANSLATE_BATCH',
          sourceLanguage: input.sourceLanguage,
          targetLanguage: input.targetLanguage,
          cues: chunk.map((cue) => ({ id: cue.id, text: cue.text })),
          ...(context ? { previousContext: context } : {}),
        });
      } catch (error) {
        if (signal?.aborted) throw signal.reason ?? new DOMException('Aborted', 'AbortError');
        if (error instanceof SubMateError) throw error;
        throw new SubMateError(
          'TRANSLATION_FAILED',
          error instanceof Error ? error.message : 'Cloud translation failed',
          { cause: error },
        );
      }
      translations.push(...result.translations);
      unresolved += result.unresolved.length;
      context = result.context || context;
      completed += chunk.length;
      onProgress?.({
        phase: 'translating',
        progress: input.cues.length ? completed / input.cues.length : 1,
        completedCues: completed,
        totalCues: input.cues.length,
      });
    }

    // Lines the model never returned come back empty, and the renderer falls
    // back to the original text for those rather than showing a gap.
    if (unresolved) console.info(`[SubMate] ${unresolved} line(s) were left untranslated by the model`);

    return {
      sourceHash: input.sourceHash,
      sourceLanguage: input.sourceLanguage,
      targetLanguage: input.targetLanguage,
      engine: { id: this.id, version: this.version },
      translations,
    };
  }

  destroy(): void {
    // Nothing is held open; each batch is an independent message.
  }
}
