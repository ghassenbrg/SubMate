import type { FlixTranslateSettings } from './schema';
import { canonicalLanguage } from './schema';

export const defaultSettings = (): FlixTranslateSettings => {
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
    displayMode: 'bilingual',
    translatedFontScale: 1,
    verticalPosition: 0.13,
    showPlayerStatus: true,
    onboardingComplete: false,
    debugMode: false,
  };
};
