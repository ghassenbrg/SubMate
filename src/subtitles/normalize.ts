import type { SubtitleCue } from './models';

export const normalizeText = (value: string): string =>
  value
    .normalize('NFC')
    .replaceAll('\r\n', '\n')
    .replaceAll('\r', '\n')
    .split('\n')
    .map((line) => line.replaceAll(/[\t\f\v ]+/g, ' ').trim())
    .join('\n')
    .replaceAll(/\n{3,}/g, '\n\n')
    .trim();

const validStableId = (value: string) => /^[\p{L}\p{N}._:-]{1,100}$/u.test(value);

export function normalizeCues(
  input: Array<Omit<SubtitleCue, 'id'> & { id?: string }>,
): SubtitleCue[] {
  const sorted = input
    .filter((cue) => Number.isFinite(cue.startMs) && Number.isFinite(cue.endMs) && cue.endMs >= cue.startMs)
    .map((cue) => ({ ...cue, startMs: Math.round(cue.startMs), endMs: Math.round(cue.endMs), sourceText: normalizeText(cue.sourceText) }))
    .sort((a, b) => a.startMs - b.startMs || a.endMs - b.endMs);
  const counts = new Map<string, number>();
  for (const cue of sorted) {
    if (cue.id && validStableId(cue.id)) counts.set(cue.id, (counts.get(cue.id) ?? 0) + 1);
  }
  return sorted.map((cue, index) => {
    const stable = cue.id && validStableId(cue.id) && counts.get(cue.id) === 1 ? cue.id : undefined;
    return {
      id: stable ?? `c${String(index + 1).padStart(6, '0')}`,
      startMs: cue.startMs,
      endMs: cue.endMs,
      sourceText: cue.sourceText,
      ...(cue.translatedText !== undefined ? { translatedText: normalizeText(cue.translatedText) } : {}),
    };
  });
}
