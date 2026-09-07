import { parseTtml } from './ttml-parser';
import { parseSrt, parseVtt } from './vtt-parser';
import type { SubtitleCue } from './models';

export function parseSubtitle(input: string, profile = '', contentType = ''): SubtitleCue[] {
  const start = input.trimStart().slice(0, 100).toLowerCase();
  if (profile.toLowerCase().includes('vtt') || contentType.includes('vtt') || start.startsWith('webvtt')) {
    return parseVtt(input);
  }
  if (profile.toLowerCase().includes('srt') || /^\d+\s*\n\d{2}:\d{2}:/.test(input.trimStart())) {
    return parseSrt(input);
  }
  return parseTtml(input);
}
