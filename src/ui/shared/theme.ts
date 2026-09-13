import { t } from '../../i18n';
import type { SubMateSettings } from '../../settings/schema';
import { loadSettings, saveSettings, watchSettings } from '../../settings/store';

export type ThemeMode = SubMateSettings['theme'];

/**
 * The preference itself lives in settings, so the in-player controls — which
 * run in a content script and cannot see this page's localStorage — follow it
 * too. localStorage only caches it, so the page can paint in the right theme
 * before the async settings read comes back.
 */
const CACHE_KEY = 'submate-theme';
const ORDER: ThemeMode[] = ['system', 'light', 'dark'];
const listeners = new Set<() => void>();
let current: ThemeMode | undefined;

function isThemeMode(value: unknown): value is ThemeMode {
  return value === 'system' || value === 'light' || value === 'dark';
}

export function getStoredTheme(): ThemeMode {
  if (current) return current;
  try {
    const cached = localStorage.getItem(CACHE_KEY);
    if (isThemeMode(cached)) return cached;
  } catch {
    // Private contexts can disallow storage access; fall back to system.
  }
  return 'system';
}

function applyTheme(mode: ThemeMode): void {
  current = mode;
  try { localStorage.setItem(CACHE_KEY, mode); } catch { /* ignore */ }
  if (mode === 'system') delete document.documentElement.dataset.theme;
  else document.documentElement.dataset.theme = mode;
  for (const listener of listeners) listener();
}

export function setTheme(mode: ThemeMode): void {
  applyTheme(mode);
  void saveSettings({ theme: mode }).catch(() => undefined);
}

/**
 * Applies the cached preference immediately, then the stored setting, and
 * keeps following it when another surface changes it.
 */
export function initTheme(): void {
  applyTheme(getStoredTheme());
  void loadSettings().then((settings) => {
    if (settings.theme !== current) applyTheme(settings.theme);
  }).catch(() => undefined);
  watchSettings((settings) => {
    if (settings.theme !== current) applyTheme(settings.theme);
  });
}

const LABEL_KEY: Record<ThemeMode, 'themeSystem' | 'themeLight' | 'themeDark'> = {
  system: 'themeSystem',
  light: 'themeLight',
  dark: 'themeDark',
};

const ICON_PATHS: Record<ThemeMode, string> = {
  light: 'M12 3v2m0 14v2m9-9h-2M5 12H3m14.36-6.36-1.42 1.42M7.06 16.94l-1.42 1.42m0-12.72 1.42 1.42M16.94 16.94l1.42 1.42M12 8a4 4 0 1 0 0 8 4 4 0 0 0 0-8Z',
  dark: 'M20.5 14.2A8.5 8.5 0 0 1 9.8 3.5a.6.6 0 0 0-.75-.74A9 9 0 1 0 21.24 15a.6.6 0 0 0-.74-.8Z',
  system: 'M4 5.5A1.5 1.5 0 0 1 5.5 4h13A1.5 1.5 0 0 1 20 5.5v9A1.5 1.5 0 0 1 18.5 16h-13A1.5 1.5 0 0 1 4 14.5v-9ZM9 20h6M12 16v4',
};

function buildIcon(mode: ThemeMode): SVGSVGElement {
  const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  svg.setAttribute('class', 'icon');
  svg.setAttribute('viewBox', '0 0 24 24');
  svg.setAttribute('fill', 'none');
  svg.setAttribute('aria-hidden', 'true');
  const path = document.createElementNS('http://www.w3.org/2000/svg', 'path');
  path.setAttribute('d', ICON_PATHS[mode]);
  path.setAttribute('stroke', 'currentColor');
  path.setAttribute('stroke-width', '2');
  path.setAttribute('stroke-linecap', 'round');
  path.setAttribute('stroke-linejoin', 'round');
  svg.append(path);
  return svg;
}

/**
 * A single icon button that cycles system → light → dark → system. One
 * control rather than a three-way switch keeps it usable at popup width, and
 * the icon itself communicates the active mode without a visible label.
 */
export function createThemeToggle(): HTMLButtonElement {
  const button = document.createElement('button');
  button.type = 'button';
  button.className = 'theme-toggle';

  const sync = () => {
    const mode = getStoredTheme();
    button.replaceChildren(buildIcon(mode));
    button.dataset.mode = mode;
    button.setAttribute('aria-label', t('themeToggleAria', t(LABEL_KEY[mode])));
    button.title = t(LABEL_KEY[mode]);
  };

  button.addEventListener('click', () => {
    const mode = getStoredTheme();
    setTheme(ORDER[(ORDER.indexOf(mode) + 1) % ORDER.length] ?? 'system');
  });

  // Follows changes made elsewhere too, and stops once the button is gone.
  const listener = () => {
    if (!button.isConnected && button.dataset.mode) listeners.delete(listener);
    else sync();
  };
  listeners.add(listener);
  sync();
  return button;
}
