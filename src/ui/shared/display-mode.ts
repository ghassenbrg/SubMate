import { t } from '../../i18n';
import type { SubMateSettings } from '../../settings/schema';

type DisplayMode = SubMateSettings['displayMode'];

const SVG_NS = 'http://www.w3.org/2000/svg';

function bar(x: number, y: number, width: number, opacity = 1): SVGRectElement {
  const rect = document.createElementNS(SVG_NS, 'rect');
  rect.setAttribute('x', String(x));
  rect.setAttribute('y', String(y));
  rect.setAttribute('width', String(width));
  rect.setAttribute('height', '3.2');
  rect.setAttribute('rx', '1.6');
  rect.setAttribute('fill', 'currentColor');
  if (opacity !== 1) rect.setAttribute('opacity', String(opacity));
  return rect;
}

/**
 * A miniature of what the viewer will actually see on the video: subtitle bars
 * sitting low in a frame. Recognising the layout as a picture is faster than
 * reading three similar phrases, and it survives translation into any locale.
 */
export function displayModeArtwork(mode: DisplayMode): SVGSVGElement {
  const svg = document.createElementNS(SVG_NS, 'svg');
  svg.setAttribute('viewBox', '0 0 48 30');
  svg.setAttribute('class', 'mode-tile-art');
  svg.setAttribute('aria-hidden', 'true');
  if (mode === 'bilingual') svg.append(bar(15, 12, 18, 0.45), bar(9, 19, 30));
  if (mode === 'translation-only') svg.append(bar(9, 16, 30));
  if (mode === 'off') {
    svg.append(bar(9, 16, 30, 0.22));
    const slash = document.createElementNS(SVG_NS, 'path');
    slash.setAttribute('d', 'M11 23 37 8');
    slash.setAttribute('stroke', 'currentColor');
    slash.setAttribute('stroke-width', '2.4');
    slash.setAttribute('stroke-linecap', 'round');
    svg.append(slash);
  }
  return svg;
}

/** Short label for the tile, plus the full phrasing for its accessible name. */
export function displayModeLabels(): Array<[DisplayMode, string, string]> {
  return [
    ['bilingual', t('displayModeBoth'), t('originalAndTranslation')],
    ['translation-only', t('displayModeTranslation'), t('translationOnly')],
    ['off', t('off'), t('off')],
  ];
}

/**
 * The three display modes as picture tiles.
 *
 * Shared by the popup, the options page and the in-player panel — the same
 * control in all three places, styled by whichever stylesheet owns it (the
 * overlay carries its own copy inside its shadow root).
 */
export function createDisplayModeTiles(value: DisplayMode, onCommit: (mode: DisplayMode) => void): HTMLDivElement {
  const group = document.createElement('div');
  group.className = 'mode-tiles';
  group.setAttribute('role', 'group');
  group.setAttribute('aria-label', t('subtitleDisplay'));

  for (const [mode, short, full] of displayModeLabels()) {
    const tile = document.createElement('button');
    tile.type = 'button';
    tile.className = 'mode-tile';
    tile.dataset.mode = mode;
    tile.setAttribute('aria-pressed', String(mode === value));
    tile.setAttribute('aria-label', full);
    const frame = document.createElement('span');
    frame.className = 'mode-tile-frame';
    frame.append(displayModeArtwork(mode));
    const label = document.createElement('span');
    label.className = 'mode-tile-label';
    label.textContent = short;
    tile.append(frame, label);
    tile.addEventListener('click', () => onCommit(mode));
    group.append(tile);
  }

  return group;
}
