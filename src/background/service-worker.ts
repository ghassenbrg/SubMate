import { cacheStats, clearCache, getSource, getSourceForContent, getTranslation, putSource, putTranslation } from '../cache/db';
import type { CacheRequest } from '../cache/messages';
import { defaultSettings } from '../settings/defaults';
import {
  translateAvailability,
  translateBatch,
  type TranslateBatchRequest,
} from './translate-batch';
import { SETTINGS_KEY } from '../settings/schema';

chrome.runtime.onInstalled.addListener(async () => {
  const stored = await chrome.storage.local.get(SETTINGS_KEY);
  if (!stored[SETTINGS_KEY]) await chrome.storage.local.set({ [SETTINGS_KEY]: defaultSettings() });
});

chrome.runtime.onMessage.addListener((raw: unknown, _sender, sendResponse) => {
  const request = raw as
    | CacheRequest
    | { type: 'OPEN_OPTIONS' }
    | { type: 'TRANSLATE_AVAILABILITY' }
    | TranslateBatchRequest;
  if (!request || typeof request.type !== 'string') return false;
  if (request.type === 'OPEN_OPTIONS') {
    void chrome.runtime.openOptionsPage();
    return false;
  }
  if (request.type === 'TRANSLATE_AVAILABILITY' || request.type === 'TRANSLATE_BATCH') {
    const wantsAvailability = request.type === 'TRANSLATE_AVAILABILITY';
    const message = raw as TranslateBatchRequest;
    void (async () => {
      if (wantsAvailability) {
        return translateAvailability(String(message.vendor ?? ''), String(message.model ?? ''));
      }
      return translateBatch(message);
    })().then(
      (value) => sendResponse({ ok: true, value }),
      // Vendor errors are already redacted; this is the last line of defence.
      (error: unknown) => sendResponse({
        ok: false,
        error: (error instanceof Error ? error.message : String(error)).slice(0, 300),
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
