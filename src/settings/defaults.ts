import type { SubMateSettings } from './schema';
import { canonicalLanguage } from './schema';

export const defaultSettings = (): SubMateSettings => {
  let locale = 'und';
  try {
    locale = canonicalLanguage(chrome.i18n?.getUILanguage?.() || navigator.language || 'und');
  } catch {
    // "und" is the standards-defined undetermined language code.
  }
  return {
    enabled: true,
    autoTranslate: true,
    preferredTargetLanguage: locale,
    translationEngine: 'chrome-local',
    cloudVendor: 'gemini',
    cloudModel: '',
    cloudBaseUrl: '',
    displayMode: 'bilingual',
    translatedFontScale: 1,
    verticalPosition: 0.13,
    subtitleStylePreset: 'soft-box',
    subtitleBackground: 'soft',
    subtitleOutline: 'shadow',
    subtitleTextColor: '#ffffff',
    translatedFontWeight: 650,
    subtitleOpacity: 1,
    subtitleLineHeight: 1.22,
    showPlayerStatus: true,
    theme: 'system',
    onboardingComplete: false,
    debugMode: false,
  };
};
