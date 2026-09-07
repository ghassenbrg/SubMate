import type { SubtitleCue } from './models';
import { normalizeText } from './normalize';

const bytesToHex = (bytes: Uint8Array) => [...bytes].map((byte) => byte.toString(16).padStart(2, '0')).join('');

export async function sha256(value: string): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(value));
  return `sha256:${bytesToHex(new Uint8Array(digest))}`;
}

export async function hashSubtitle(sourceLanguage: string, cues: SubtitleCue[]): Promise<string> {
  const canonical = JSON.stringify({
    sourceLanguage,
    cues: cues.map((cue) => [cue.id, cue.startMs, cue.endMs, normalizeText(cue.sourceText)]),
  });
  return sha256(canonical);
}

export async function translationCacheKey(
  sourceHash: string,
  targetLanguage: string,
  engineId: string,
  engineVersion: string,
): Promise<string> {
  return sha256(`${sourceHash}|${targetLanguage}|${engineId}|${engineVersion}`);
}
