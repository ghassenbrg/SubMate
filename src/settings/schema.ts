import { DEFAULT_CLOUD_PROVIDER, isCloudProviderId, normalizeBaseUrl } from '../translation/cloud/providers';

export interface SubMateSettings {
  enabled: boolean;
  autoTranslate: boolean;
  preferredTargetLanguage: string;
  preferredSourceLanguage?: string | undefined;
  translationEngine: 'chrome-local' | 'manual' | 'cloud-api';
  /** Cloud provider id; only meaningful when the engine is 'cloud-api'. */
  cloudVendor: string;
  /** Empty means the provider's own default model. */
  cloudModel: string;
  /** Endpoint for the custom provider; presets ignore it. */
  cloudBaseUrl: string;
  displayMode: 'bilingual' | 'translation-only' | 'off';
  translatedFontScale: number;
  verticalPosition: number;
  subtitleStylePreset: 'netflix' | 'soft-box' | 'solid-box' | 'outline' | 'minimal' | 'custom';
  subtitleBackground: 'none' | 'soft' | 'solid';
  subtitleOutline: 'none' | 'shadow' | 'outline';
  subtitleTextColor: string;
  translatedFontWeight: number;
  subtitleOpacity: number;
  subtitleLineHeight: number;
  showPlayerStatus: boolean;
  /** Light or dark UI, or follow the OS. Shared by the popup, options page and in-player controls. */
  theme: 'system' | 'light' | 'dark';
  onboardingComplete: boolean;
  debugMode: boolean;
}

export const SETTINGS_KEY = 'submateSettings';

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

export const validateSettings = (value: unknown): SubMateSettings => {
  if (!value || typeof value !== 'object') throw new TypeError('Settings must be an object');
  const v = value as Record<string, unknown>;
  const target = canonicalLanguage(String(v.preferredTargetLanguage ?? navigator.language));
  const source = v.preferredSourceLanguage
    ? canonicalLanguage(String(v.preferredSourceLanguage))
    : undefined;
  const engines = ['chrome-local', 'manual', 'cloud-api'] as const;
  const engine = engines.includes(v.translationEngine as (typeof engines)[number])
    ? (v.translationEngine as SubMateSettings['translationEngine'])
    : 'chrome-local';
  // The API key deliberately lives outside settings; see cloud/credentials.ts.
  const cloudVendor = isCloudProviderId(v.cloudVendor) ? v.cloudVendor : DEFAULT_CLOUD_PROVIDER;
  // Slashes and colons appear in real ids: openai/gpt-oss-20b, llama3.3:70b.
  const cloudModel = typeof v.cloudModel === 'string' && /^[\w.:/@-]{0,128}$/.test(v.cloudModel.trim())
    ? v.cloudModel.trim()
    : '';
  const cloudBaseUrl = typeof v.cloudBaseUrl === 'string' ? normalizeBaseUrl(v.cloudBaseUrl) ?? '' : '';
  const modes = ['bilingual', 'translation-only', 'off'] as const;
  const displayMode = modes.includes(v.displayMode as (typeof modes)[number])
    ? (v.displayMode as SubMateSettings['displayMode'])
    : 'bilingual';
  const scale = Number(v.translatedFontScale);
  const position = Number(v.verticalPosition);
  const stylePresets = ['netflix', 'soft-box', 'solid-box', 'outline', 'minimal', 'custom'] as const;
  const backgrounds = ['none', 'soft', 'solid'] as const;
  const outlines = ['none', 'shadow', 'outline'] as const;
  const preset = stylePresets.includes(v.subtitleStylePreset as (typeof stylePresets)[number])
    ? (v.subtitleStylePreset as SubMateSettings['subtitleStylePreset'])
    : 'soft-box';
  const background = backgrounds.includes(v.subtitleBackground as (typeof backgrounds)[number])
    ? (v.subtitleBackground as SubMateSettings['subtitleBackground'])
    : 'soft';
  const outline = outlines.includes(v.subtitleOutline as (typeof outlines)[number])
    ? (v.subtitleOutline as SubMateSettings['subtitleOutline'])
    : 'shadow';
  const textColor = typeof v.subtitleTextColor === 'string' && /^#[0-9a-f]{6}$/i.test(v.subtitleTextColor)
    ? v.subtitleTextColor.toLowerCase()
    : '#ffffff';
  const weight = Number(v.translatedFontWeight);
  const opacity = Number(v.subtitleOpacity);
  const lineHeight = Number(v.subtitleLineHeight);
  return {
    enabled: v.enabled !== false,
    autoTranslate: v.autoTranslate !== false,
    preferredTargetLanguage: target,
    ...(source ? { preferredSourceLanguage: source } : {}),
    translationEngine: engine,
    cloudVendor,
    cloudModel,
    cloudBaseUrl,
    displayMode,
    translatedFontScale: Number.isFinite(scale) ? Math.min(1.8, Math.max(0.7, scale)) : 1,
    verticalPosition: Number.isFinite(position) ? Math.min(0.42, Math.max(0.04, position)) : 0.13,
    subtitleStylePreset: preset,
    subtitleBackground: background,
    subtitleOutline: outline,
    subtitleTextColor: textColor,
    translatedFontWeight: Number.isFinite(weight) ? Math.round(Math.min(800, Math.max(400, weight)) / 50) * 50 : 650,
    subtitleOpacity: Number.isFinite(opacity) ? Math.min(1, Math.max(0.5, opacity)) : 1,
    subtitleLineHeight: Number.isFinite(lineHeight) ? Math.min(1.6, Math.max(1, lineHeight)) : 1.22,
    showPlayerStatus: v.showPlayerStatus !== false,
    theme: v.theme === 'light' || v.theme === 'dark' ? v.theme : 'system',
    onboardingComplete: v.onboardingComplete === true,
    debugMode: v.debugMode === true,
  };
};
