import { cacheStats, clearCache, getSource, getSourceForContent, getTranslation, putSource, putTranslation } from '../cache/db';
import type { CacheRequest } from '../cache/messages';
import { defaultSettings } from '../settings/defaults';
import {
  translateAvailability,
  translateBatch,
  translateModels,
  type TranslateBatchRequest,
} from './translate-batch';
import { SETTINGS_KEY } from '../settings/schema';
import { CloudVendorError } from '../translation/cloud/vendor';

chrome.runtime.onInstalled.addListener(async () => {
  const stored = await chrome.storage.local.get(SETTINGS_KEY);
  if (!stored[SETTINGS_KEY]) await chrome.storage.local.set({ [SETTINGS_KEY]: defaultSettings() });
});

chrome.runtime.onMessage.addListener((raw: unknown, sender, sendResponse) => {
  const request = raw as
    | CacheRequest
    | { type: 'OPEN_OPTIONS' }
    | { type: 'TRANSLATE_AVAILABILITY' }
    | { type: 'TRANSLATE_MODELS' }
    | TranslateBatchRequest;
  if (!request || typeof request.type !== 'string') return false;
  if (request.type === 'OPEN_OPTIONS') {
    void chrome.runtime.openOptionsPage();
    return false;
  }
  if (request.type === 'TRANSLATE_AVAILABILITY' || request.type === 'TRANSLATE_BATCH' || request.type === 'TRANSLATE_MODELS') {
    // Model listing is an options-page concern; content scripts have no use for it.
    const fromExtensionPage = sender.url?.startsWith(chrome.runtime.getURL('')) ?? false;
    void (async () => {
      switch (request.type) {
        case 'TRANSLATE_AVAILABILITY': return translateAvailability();
        case 'TRANSLATE_MODELS':
          if (!fromExtensionPage) throw new Error('Not allowed');
          return translateModels();
        default: return translateBatch(request);
      }
    })().then(
      (value) => sendResponse({ ok: true, value }),
      // Vendor errors are already redacted; this is the last line of defence.
      (error: unknown) => sendResponse({
        ok: false,
        error: (error instanceof Error ? error.message : String(error)).slice(0, 300),
        ...(error instanceof CloudVendorError ? { reason: error.reason } : {}),
      }),
    );
    return true;
  }
  if (!request.type.startsWith('CACHE_')) return false;
  void (async () => {
    switch (request.type) {
      case 'CACHE_GET_TRANSLATION': return getTranslation(request.cacheKey);
      case 'CACHE_PUT_TRANSLATION': return putTranslation(request.record);
      case 'CACHE_PUT_SOURCE': return putSource(request.track);
      case 'CACHE_GET_SOURCE': return getSource(request.sourceHash);
      case 'CACHE_GET_CONTENT_SOURCE': return getSourceForContent(request.contentId);
      case 'CACHE_CLEAR': return clearCache();
      case 'CACHE_STATS': return cacheStats();
    }
  })().then(
    (value) => sendResponse({ ok: true, value }),
    (error: unknown) => sendResponse({ ok: false, error: error instanceof Error ? error.message : String(error) }),
  );
  return true;
});
