/**
 * Batch protocol for cloud translation engines.
 *
 * A language model is asked to return a JSON object keyed by cue id. Models
 * routinely wrap that in prose or markdown fences, drop lines, merge two
 * subtitles into one, or renumber — so the response is parsed defensively and
 * reconciled against the ids that were actually requested. Nothing here trusts
 * response ordering.
 */

export interface BatchCue {
  id: string;
  text: string;
}

export interface BatchRequest {
  sourceLanguage: string;
  targetLanguage: string;
  cues: BatchCue[];
  /** Tail of the previous batch, so names and pronouns stay consistent. */
  previousContext?: string;
}

export interface BatchOutcome {
  translations: Map<string, string>;
  /** Requested ids the model did not return usable text for. */
  missing: string[];
}

/**
 * Bumped whenever the prompt changes in a way that changes output, so cached
 * translations from an older prompt are not served as if they were current.
 */
export const CLOUD_PROMPT_REVISION = 2;

export interface BatchPrompt {
  /** Standing instructions, sent as the system message. */
  system: string;
  /** The subtitles to translate, sent as the user message. */
  user: string;
}

/**
 * "Japanese (ja)" rather than "ja". Bare codes are ambiguous to a model, and a
 * model unsure of the target language tends to hand the input straight back.
 */
export function languageLabel(tag: string): string {
  try {
    const name = new Intl.DisplayNames(['en'], { type: 'language' }).of(tag);
    return name && name !== tag ? `${name} (${tag})` : tag;
  } catch {
    return tag;
  }
}

/** Cues are sent as an id-keyed object so ordering cannot carry meaning. */
export function buildPrompt(request: BatchRequest): BatchPrompt {
  const source = languageLabel(request.sourceLanguage);
  const target = languageLabel(request.targetLanguage);
  const payload = Object.fromEntries(request.cues.map((cue) => [cue.id, cue.text]));
  const system = [
    `You translate ${source} subtitles into ${target}.`,
    '',
    `Every value you return must be written in ${target}. Never copy the ${source} text back;`,
    'the only exception is a line that is purely a name, a number or a symbol.',
    '',
    `Reply with a JSON object that has exactly the same keys as the input, each mapped to its ${target} translation.`,
    '- One subtitle in, one subtitle out. Do not add, drop, merge, split or renumber keys.',
    '- Keep each line short enough to read on screen, and preserve line breaks within an entry.',
    '- Keep speaker labels, sound-effect brackets and music symbols, translating any words inside them.',
    '- Reply with the JSON object only: no commentary and no markdown fences.',
  ].join('\n');
  const context = request.previousContext
    ? `Preceding dialogue, for continuity of names and tone only (do not return it):\n${request.previousContext}\n\n`
    : '';
  const user = `${context}Translate into ${target}:\n${JSON.stringify(payload)}`;
  return { system, user };
}

const letters = /\p{L}{2,}/u;
const baseLanguage = (tag: string) => tag.split('-')[0]?.toLowerCase() ?? tag;

/**
 * Ids whose "translation" is just the source text handed back.
 *
 * A model that misreads the task can return well-formed JSON that is entirely
 * untranslated; without this check it would pass every structural test and be
 * cached as a finished translation. Lines with no letters (music notes,
 * numbers) are legitimately unchanged and are never counted.
 */
export function echoedIds(
  cues: BatchCue[],
  translations: Map<string, string>,
  sourceLanguage: string,
  targetLanguage: string,
): string[] {
  if (baseLanguage(sourceLanguage) === baseLanguage(targetLanguage)) return [];
  return cues
    .filter((cue) => letters.test(cue.text) && translations.get(cue.id)?.trim() === cue.text.trim())
    .map((cue) => cue.id);
}

/**
 * Removes markdown fencing and any prose surrounding the JSON body.
 *
 * Handles both an object and a top-level array, because models return either.
 * Anchoring on whichever bracket appears first matters: slicing an array from
 * its first `{` to its last `}` would strip the enclosing brackets and produce
 * something that no longer parses.
 */
export function extractJsonObject(raw: string): string | undefined {
  const trimmed = raw.trim();
  const fenced = /```(?:json)?\s*([\s\S]*?)\s*```/i.exec(trimmed);
  const candidate = (fenced?.[1] ?? trimmed).trim();
  const objectStart = candidate.indexOf('{');
  const arrayStart = candidate.indexOf('[');
  const isArray = arrayStart >= 0 && (objectStart < 0 || arrayStart < objectStart);
  const start = isArray ? arrayStart : objectStart;
  if (start < 0) return undefined;
  const end = candidate.lastIndexOf(isArray ? ']' : '}');
  if (end <= start) return undefined;
  return candidate.slice(start, end + 1);
}

/**
 * Reconciles a model response against the ids that were requested.
 *
 * Unknown ids are discarded rather than trusted, and every requested id that
 * came back empty or absent is reported so the caller can retry just those.
 */
export function reconcileBatch(raw: string, requested: BatchCue[]): BatchOutcome {
  const translations = new Map<string, string>();
  const body = extractJsonObject(raw);
  if (body) {
    let parsed: unknown;
    try {
      parsed = JSON.parse(body);
    } catch {
      parsed = undefined;
    }
    const wanted = new Set(requested.map((cue) => cue.id));
    // Accept both the requested object shape and the array-of-objects shape
    // models sometimes produce instead.
    if (Array.isArray(parsed)) {
      for (const entry of parsed) {
        const item = entry as Record<string, unknown> | null;
        const id = typeof item?.id === 'string' ? item.id : undefined;
        const text = typeof item?.text === 'string' ? item.text : undefined;
        if (id && text !== undefined && wanted.has(id)) translations.set(id, text);
      }
    } else if (parsed && typeof parsed === 'object') {
      for (const [id, value] of Object.entries(parsed as Record<string, unknown>)) {
        if (!wanted.has(id)) continue;
        if (typeof value === 'string') translations.set(id, value);
        else if (value && typeof value === 'object' && typeof (value as { text?: unknown }).text === 'string') {
          translations.set(id, (value as { text: string }).text);
        }
      }
    }
  }
  const missing = requested
    .filter((cue) => cue.text.trim() && !(translations.get(cue.id) ?? '').trim())
    .map((cue) => cue.id);
  // A cue with no source text needs no translation, but must still be present.
  for (const cue of requested) {
    if (!cue.text.trim() && !translations.has(cue.id)) translations.set(cue.id, '');
  }
  return { translations, missing };
}

/** Last few lines of a finished batch, used as continuity context. */
export function contextFrom(cues: BatchCue[], translations: Map<string, string>, lines = 3): string {
  return cues
    .slice(-lines)
    .map((cue) => `${cue.text} -> ${translations.get(cue.id) ?? ''}`)
    .filter((line) => line.trim() !== ' -> ')
    .join('\n')
    .slice(0, 1_000);
}
