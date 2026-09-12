import type { SubMateSettings } from '../settings/schema';
import type { TranslationProvider } from './provider';
import { ChromeTranslatorProvider } from './providers/chrome-translator';
import { CloudTranslatorProvider } from './providers/cloud-translator';

/**
 * Builds the translation engine the user selected.
 *
 * Manual mode still gets the on-device provider: it is never asked to
 * translate, but the orchestrator queries availability through the same
 * interface, and a null object here would only add a branch to every call site.
 */
export function createProvider(settings: SubMateSettings): TranslationProvider {
  if (settings.translationEngine === 'cloud-api') {
    return new CloudTranslatorProvider(settings.cloudVendor, settings.cloudModel);
  }
  return new ChromeTranslatorProvider();
}

/** True when a settings change requires a different engine instance. */
export const providerChanged = (a: SubMateSettings, b: SubMateSettings): boolean =>
  a.translationEngine !== b.translationEngine ||
  a.cloudVendor !== b.cloudVendor ||
  a.cloudModel !== b.cloudModel;
