export interface FlixTranslateSettings {
  enabled: boolean;
  autoTranslate: boolean;
  preferredTargetLanguage: string;
  preferredSourceLanguage?: string | undefined;
  translationEngine: 'chrome-local' | 'manual';
  displayMode: 'bilingual' | 'translation-only' | 'off';
  translatedFontScale: number;
  verticalPosition: number;
  showPlayerStatus: boolean;
  onboardingComplete: boolean;
  debugMode: boolean;
}

export const SETTINGS_KEY = 'flixtranslateSettings';

export const canonicalLanguage = (value: string): string => {
  const normalized = value.trim().replaceAll('_', '-');
  if (!normalized || normalized.length > 35) throw new TypeError('Invalid language tag');
  try {
    const [canonical] = Intl.getCanonicalLocales(normalized);
    if (!canonical) throw new TypeError('Invalid language tag');
    return canonical;
  } catch {
    throw new TypeError('Invalid BCP-47 language tag');
  }
};

export const validateSettings = (value: unknown): FlixTranslateSettings => {
  if (!value || typeof value !== 'object') throw new TypeError('Settings must be an object');
  const v = value as Record<string, unknown>;
  const target = canonicalLanguage(String(v.preferredTargetLanguage ?? navigator.language));
  const source = v.preferredSourceLanguage
    ? canonicalLanguage(String(v.preferredSourceLanguage))
    : undefined;
  const engine = v.translationEngine === 'manual' ? 'manual' : 'chrome-local';
  const modes = ['bilingual', 'translation-only', 'off'] as const;
  const displayMode = modes.includes(v.displayMode as (typeof modes)[number])
    ? (v.displayMode as FlixTranslateSettings['displayMode'])
    : 'bilingual';
  const scale = Number(v.translatedFontScale);
  const position = Number(v.verticalPosition);
  return {
    enabled: v.enabled !== false,
    autoTranslate: v.autoTranslate !== false,
    preferredTargetLanguage: target,
    ...(source ? { preferredSourceLanguage: source } : {}),
    translationEngine: engine,
    displayMode,
    translatedFontScale: Number.isFinite(scale) ? Math.min(1.8, Math.max(0.7, scale)) : 1,
    verticalPosition: Number.isFinite(position) ? Math.min(0.42, Math.max(0.04, position)) : 0.13,
    showPlayerStatus: v.showPlayerStatus !== false,
    onboardingComplete: v.onboardingComplete === true,
    debugMode: v.debugMode === true,
  };
};
