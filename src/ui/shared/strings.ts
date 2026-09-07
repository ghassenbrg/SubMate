import type { TranslationStatus } from '../../subtitles/models';
import { t } from '../../i18n';

export const strings = {
  get product() { return t('extensionName'); },
  get tagline() { return t('tagline'); },
  get notNetflix() { return t('notNetflix'); },
  get noPlayer() { return t('noPlayer'); },
  get importReady() { return t('importReady'); },
  get importFailed() { return t('importFailed'); },
};

export function statusLabel(status: TranslationStatus): string {
  if (status.message) return status.message;
  switch (status.state) {
    case 'disabled': return t('statusDisabled');
    case 'discovering': return t('statusDiscovering');
    case 'downloading_source': return t('statusDownloadingSource');
    case 'parsing_source': return t('statusParsingSource');
    case 'checking_cache': return t('statusCheckingCache');
    case 'target_available': return t('statusTargetAvailable');
    case 'needs_user_activation': return t('statusNeedsActivation');
    case 'downloading_model': return t('statusDownloadingModel');
    case 'translating': return t('statusTranslating');
    case 'validating': return t('statusValidating');
    case 'ready': return status.imported ? t('statusImportedReady') : status.cacheHit ? t('statusSavedReady') : t('statusReady');
    case 'unsupported_image_track': return t('statusImageUnsupported');
    case 'no_text_track': return t('statusNoTextTrack');
    case 'failed': return t('statusFailed');
    default: return t('statusWaiting');
  }
}
