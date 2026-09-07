export interface TextCueInput { id: string; text: string }

export function chunkCues<T extends TextCueInput>(
  cues: T[],
  options: { maxCues?: number; maxCharacters?: number } = {},
): T[][] {
  const maxCues = Math.max(1, options.maxCues ?? 35);
  const maxCharacters = Math.max(1, options.maxCharacters ?? 4_000);
  const chunks: T[][] = [];
  let current: T[] = [];
  let characters = 0;
  for (const cue of cues) {
    const length = cue.text.length;
    if (current.length && (current.length >= maxCues || characters + length > maxCharacters)) {
      chunks.push(current);
      current = [];
      characters = 0;
    }
    current.push(cue);
    characters += length;
  }
  if (current.length) chunks.push(current);
  return chunks;
}
