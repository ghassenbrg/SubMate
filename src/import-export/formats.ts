import { FlixTranslateError } from '../shared-errors';
import type { PlatformId, SubtitleTrack, TranslationResult } from '../subtitles/models';
import { normalizeText } from '../subtitles/normalize';
import { formatSrtTime, formatVttTime } from '../subtitles/time';
import { parseSrt, parseVtt } from '../subtitles/vtt-parser';
import { canonicalLanguage } from '../settings/schema';

export interface FlixTranslateSourcePackage {
  schemaVersion: 1;
  kind: 'flixtranslate-source';
  platform: PlatformId;
  contentId: string;
  sourceLanguage: string;
  sourceHash: string;
  cues: Array<{ id: string; startMs: number; endMs: number; text: string }>;
}

export interface FlixTranslateTranslationPackage extends TranslationResult {
  schemaVersion: 1;
  kind: 'flixtranslate-translation';
}

export function sourcePackage(track: SubtitleTrack): FlixTranslateSourcePackage {
  return {
    schemaVersion: 1,
    kind: 'flixtranslate-source',
    platform: track.platform,
    contentId: track.contentId,
    sourceLanguage: track.sourceLanguage,
    sourceHash: track.sourceHash,
    cues: track.cues.map((cue) => ({ id: cue.id, startMs: cue.startMs, endMs: cue.endMs, text: cue.sourceText })),
  };
}

const json = (value: unknown) => `${JSON.stringify(value, null, 2)}\n`;

export function exportSource(track: SubtitleTrack, format: 'json' | 'srt' | 'vtt'): string {
  if (format === 'json') return json(sourcePackage(track));
  const body = track.cues.map((cue, index) => {
    const range = format === 'srt'
      ? `${formatSrtTime(cue.startMs)} --> ${formatSrtTime(cue.endMs)}`
      : `${formatVttTime(cue.startMs)} --> ${formatVttTime(cue.endMs)}`;
    return `${format === 'srt' ? index + 1 : cue.id}\n${range}\n${cue.sourceText}`;
  }).join('\n\n');
  return format === 'vtt' ? `WEBVTT\n\n${body}\n` : `${body}\n`;
}

function parseTranslationJson(input: string, source: SubtitleTrack): TranslationResult {
  let parsed: unknown;
  try {
    parsed = JSON.parse(input);
  } catch (error) {
    throw new FlixTranslateError('IMPORT_INVALID_SCHEMA', 'Translation JSON is malformed', { cause: error });
  }
  if (!parsed || typeof parsed !== 'object') throw new FlixTranslateError('IMPORT_INVALID_SCHEMA', 'Expected an object');
  const value = parsed as Record<string, unknown>;
  if (value.schemaVersion !== 1 || value.kind !== 'flixtranslate-translation') {
    throw new FlixTranslateError('IMPORT_INVALID_SCHEMA', 'Unsupported translation schema');
  }
  if (value.sourceHash !== source.sourceHash || value.sourceLanguage !== source.sourceLanguage) {
    throw new FlixTranslateError('IMPORT_HASH_MISMATCH', 'Translation source hash or language does not match');
  }
  if (!Array.isArray(value.translations) || value.translations.length > 20_000) {
    throw new FlixTranslateError('IMPORT_INVALID_SCHEMA', 'Translations must be a bounded array');
  }
  let targetLanguage: string;
  try {
    targetLanguage = canonicalLanguage(String(value.targetLanguage ?? ''));
  } catch (error) {
    throw new FlixTranslateError('IMPORT_INVALID_SCHEMA', 'Invalid target language', { cause: error });
  }
  const translations = value.translations.map((raw) => {
    if (!raw || typeof raw !== 'object') throw new FlixTranslateError('IMPORT_INVALID_SCHEMA', 'Malformed translation entry');
    const item = raw as Record<string, unknown>;
    if (typeof item.id !== 'string' || item.id.length > 100 || typeof item.text !== 'string' || item.text.length > 100_000) {
      throw new FlixTranslateError('IMPORT_INVALID_SCHEMA', 'Malformed translation entry');
    }
    return { id: item.id, text: normalizeText(item.text) };
  });
  return {
    sourceHash: source.sourceHash,
    sourceLanguage: source.sourceLanguage,
    targetLanguage,
    engine: { id: 'manual', version: '1' },
    translations,
  };
}

function alignTimedImport(
  imported: ReturnType<typeof parseSrt>,
  source: SubtitleTrack,
  targetLanguage: string,
): TranslationResult {
  if (imported.length !== source.cues.length) {
    throw new FlixTranslateError('TRANSLATION_INCOMPLETE', `${imported.length} of ${source.cues.length} cues supplied`);
  }
  const translations = imported.map((cue, index) => {
    const sourceCue = source.cues[index];
    if (!sourceCue || Math.abs(cue.startMs - sourceCue.startMs) > 300 || Math.abs(cue.endMs - sourceCue.endMs) > 300) {
      throw new FlixTranslateError('IMPORT_AMBIGUOUS_ALIGNMENT', `Cue ${index + 1} timing does not match`);
    }
    return { id: sourceCue.id, text: cue.sourceText };
  });
  return {
    sourceHash: source.sourceHash,
    sourceLanguage: source.sourceLanguage,
    targetLanguage: canonicalLanguage(targetLanguage),
    engine: { id: 'manual', version: '1' },
    translations,
  };
}

export function importTranslation(
  input: string,
  fileName: string,
  source: SubtitleTrack,
  selectedTargetLanguage: string,
): TranslationResult {
  if (input.length > 10_000_000) throw new FlixTranslateError('IMPORT_INVALID_SCHEMA', 'Import exceeds size limit');
  const lower = fileName.toLowerCase();
  if (lower.endsWith('.json') || input.trimStart().startsWith('{')) return parseTranslationJson(input, source);
  if (lower.endsWith('.vtt') || input.trimStart().startsWith('WEBVTT')) {
    return alignTimedImport(parseVtt(input), source, selectedTargetLanguage);
  }
  if (lower.endsWith('.srt')) return alignTimedImport(parseSrt(input), source, selectedTargetLanguage);
  throw new FlixTranslateError('IMPORT_INVALID_SCHEMA', 'Unsupported import type');
}

export function exportFileName(track: SubtitleTrack, target: string | undefined, extension: string): string {
  const clean = (value: string) => value.replaceAll(/[^\p{L}\p{N}._-]+/gu, '-').slice(0, 80);
  return `flixtranslate-${clean(track.platform)}-${clean(track.contentId)}-${clean(track.sourceLanguage)}-${target ? clean(target) : 'source'}.${extension}`;
}
