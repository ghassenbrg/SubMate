import { FlixTranslateError } from '../shared-errors';
import type { SubtitleCue } from './models';
import { normalizeCues } from './normalize';
import { parseTimeExpression } from './time';

const localAttribute = (element: Element, localName: string): string | null => {
  for (const attribute of element.attributes) {
    if (attribute.localName.toLowerCase() === localName.toLowerCase()) return attribute.value;
  }
  return null;
};

function plainCueText(element: Element): string {
  let text = '';
  const walk = (node: Node) => {
    if (node.nodeType === Node.TEXT_NODE) text += node.nodeValue ?? '';
    else if (node.nodeType === Node.ELEMENT_NODE && (node as Element).localName.toLowerCase() === 'br') text += '\n';
    else for (const child of node.childNodes) walk(child);
  };
  walk(element);
  return text;
}

export function parseTtml(xmlText: string): SubtitleCue[] {
  const xml = new DOMParser().parseFromString(xmlText, 'application/xml');
  if (xml.querySelector('parsererror')) {
    throw new FlixTranslateError('SUBTITLE_PARSE_FAILED', 'Malformed TTML/DFXP XML');
  }
  const root = xml.documentElement;
  const frameRate = Number(localAttribute(root, 'frameRate')) || 30;
  const tickRate = Number(localAttribute(root, 'tickRate')) || 10_000_000;
  const parsed = [...xml.getElementsByTagNameNS('*', 'p')].map((element) => {
    const startMs = parseTimeExpression(element.getAttribute('begin'), { frameRate, tickRate });
    let endMs = parseTimeExpression(element.getAttribute('end'), { frameRate, tickRate });
    if (endMs === undefined && startMs !== undefined) {
      const duration = parseTimeExpression(element.getAttribute('dur'), { frameRate, tickRate });
      if (duration !== undefined) endMs = startMs + duration;
    }
    const id = localAttribute(element, 'id') ?? undefined;
    return {
      ...(id ? { id } : {}),
      startMs: startMs ?? Number.NaN,
      endMs: endMs ?? Number.NaN,
      sourceText: plainCueText(element),
    };
  });
  const cues = normalizeCues(parsed);
  if (!cues.length) throw new FlixTranslateError('SUBTITLE_PARSE_FAILED', 'No timed text cues in TTML');
  return cues;
}
