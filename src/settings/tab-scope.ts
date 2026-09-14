import {
  DISPLAY_MODES,
  TRANSLATION_ENGINES,
  canonicalLanguage,
  type SubMateSettings,
} from './schema';

/**
 * Settings that belong to one playback tab rather than to the browser.
 *
 * Each tab pins these when its player first attaches, so two episodes can play
 * side by side in different languages, engines or display modes. Everything
 * else (appearance, cloud provider, diagnostics) stays global.
 */
export const TAB_SCOPED_KEYS = ['enabled', 'preferredTargetLanguage', 'translationEngine', 'displayMode'] as const;

export type TabScopedKey = (typeof TAB_SCOPED_KEYS)[number];
export type TabSettings = Pick<SubMateSettings, TabScopedKey>;

export interface TabSettingsRecord {
  settings: TabSettings;
  /** Increases with every write, so a late broadcast cannot undo a newer one. */
  revision: number;
}

export const pickTabSettings = (settings: SubMateSettings): TabSettings => ({
  enabled: settings.enabled,
  preferredTargetLanguage: settings.preferredTargetLanguage,
  translationEngine: settings.translationEngine,
  displayMode: settings.displayMode,
});

export const withTabSettings = (global: SubMateSettings, tab: TabSettings | undefined): SubMateSettings =>
  tab ? { ...global, ...tab } : global;

export const tabScopedKeysIn = (patch: object): TabScopedKey[] =>
  TAB_SCOPED_KEYS.filter((key) => key in patch);

/**
 * Validates an untrusted patch. Unknown keys are dropped; a known key with an
 * invalid value rejects the whole patch rather than being silently coerced.
 */
export function sanitizeTabPatch(value: unknown): Partial<TabSettings> {
  if (!value || typeof value !== 'object') throw new TypeError('Tab settings must be an object');
  const v = value as Record<string, unknown>;
  const patch: Partial<TabSettings> = {};
  if ('enabled' in v) {
    if (typeof v.enabled !== 'boolean') throw new TypeError('Invalid enabled flag');
    patch.enabled = v.enabled;
  }
  if ('preferredTargetLanguage' in v) {
    patch.preferredTargetLanguage = canonicalLanguage(String(v.preferredTargetLanguage));
  }
  if ('translationEngine' in v) {
    if (!TRANSLATION_ENGINES.includes(v.translationEngine as TabSettings['translationEngine'])) {
      throw new TypeError('Invalid translation engine');
    }
    patch.translationEngine = v.translationEngine as TabSettings['translationEngine'];
  }
  if ('displayMode' in v) {
    if (!DISPLAY_MODES.includes(v.displayMode as TabSettings['displayMode'])) {
      throw new TypeError('Invalid display mode');
    }
    patch.displayMode = v.displayMode as TabSettings['displayMode'];
  }
  return patch;
}

/** Validates a record received over messaging; undefined when malformed. */
export function parseTabSettingsRecord(value: unknown): TabSettingsRecord | undefined {
  if (!value || typeof value !== 'object') return undefined;
  const { settings, revision } = value as Record<string, unknown>;
  if (typeof revision !== 'number' || !Number.isInteger(revision) || revision < 0) return undefined;
  try {
    const patch = sanitizeTabPatch(settings);
    if (tabScopedKeysIn(patch).length !== TAB_SCOPED_KEYS.length) return undefined;
    return { settings: patch as TabSettings, revision };
  } catch {
    return undefined;
  }
}
