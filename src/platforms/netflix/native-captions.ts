/**
 * Reads the text Netflix's own timed-text layer is currently painting.
 *
 * This lives beside the Netflix adapter rather than in the renderer so that the
 * overlay stays free of any platform DOM knowledge.
 */
export function visibleNetflixSubtitleText(): string {
  const values = [...document.querySelectorAll<HTMLElement>('.player-timedtext-text-container,[data-uia="player-subtitle"]')]
    .filter((element) => {
      const own = getComputedStyle(element);
      const container = element.closest<HTMLElement>('.player-timedtext');
      const parent = container ? getComputedStyle(container) : undefined;
      const visible = (style?: CSSStyleDeclaration) => !style || (
        style.display !== 'none' &&
        style.visibility !== 'hidden' &&
        style.visibility !== 'collapse' &&
        style.opacity !== '0'
      );
      return visible(own) && visible(parent);
    })
    .map((element) => element.textContent?.trim() ?? '')
    .filter(Boolean);
  return [...new Set(values)].join('\n');
}
