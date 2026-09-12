import { SubMateError } from '../shared-errors';
import type { SubtitleCue } from './models';
import { normalizeCues } from './normalize';
import { parseWebVttTime } from './time';

function toPlainText(value: string): string {
  const html = value
    .replaceAll(/<\/?(?:c(?:\.[^ >]+)?|v(?:\s+[^>]*)?|lang(?:\s+[^>]*)?|b|i|u|ruby|rt)>/gi, '')
    .replaceAll(/<[^>]*>/g, '');
  const document = new DOMParser().parseFromString(`<body>${html}</body>`, 'text/html');
  return document.body.textContent ?? '';
}

export interface RawVttCue {
  id?: string;
  startMs: number;
  endMs: number;
  sourceText: string;
}

export interface VttDocument {
  /** Everything before the first cue, where `X-TIMESTAMP-MAP` lives. */
  header: string;
  cues: RawVttCue[];
}

/**
 * Parses a WebVTT document without normalizing or throwing.
 *
 * Segmented HLS subtitles legitimately contain segments with zero cues, so a
 * segment-level parse must be able to report "parsed fine, nothing in it".
 */
export function parseVttDocument(input: string): VttDocument {
  const lines = input.replace(/^﻿/, '').replaceAll('\r\n', '\n').replaceAll('\r', '\n').split('\n');
  const headerLines: string[] = [];
  let index = 0;
  // The header block runs from WEBVTT up to the first blank line.
  if (lines[0]?.startsWith('WEBVTT')) {
    while (index < lines.length && lines[index]?.trim()) headerLines.push(lines[index++] ?? '');
  }
  const cues: RawVttCue[] = [];
  while (index < lines.length) {
    while (index < lines.length && !lines[index]?.trim()) index += 1;
    if (index >= lines.length) break;
    if (/^(NOTE|STYLE|REGION)(?:\s|$)/.test(lines[index] ?? '')) {
      while (index < lines.length && lines[index]?.trim()) index += 1;
      continue;
    }
    let id: string | undefined;
    let timing = lines[index] ?? '';
    if (!timing.includes('-->')) {
      id = timing.trim() || undefined;
      timing = lines[++index] ?? '';
    }
    const match = /^(\S+)\s+-->\s+(\S+)/.exec(timing.trim());
    if (!match) {
      index += 1;
      continue;
    }
    const startMs = parseWebVttTime(match[1] ?? '');
    const endMs = parseWebVttTime(match[2] ?? '');
    index += 1;
    const text: string[] = [];
    while (index < lines.length && lines[index]?.trim()) text.push(lines[index++] ?? '');
    if (startMs !== undefined && endMs !== undefined) {
      cues.push({ ...(id ? { id } : {}), startMs, endMs, sourceText: toPlainText(text.join('\n')) });
    }
  }
  return { header: headerLines.join('\n'), cues };
}

export function parseVtt(input: string): SubtitleCue[] {
  const normalized = normalizeCues(parseVttDocument(input).cues);
  if (!normalized.length) throw new SubMateError('SUBTITLE_PARSE_FAILED', 'No WebVTT cues found');
  return normalized;
}

export function parseSrt(input: string): SubtitleCue[] {
  return parseVtt(input.replace(/^﻿/, ''));
}
