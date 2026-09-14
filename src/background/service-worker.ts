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
import { sanitizeTabPatch, TAB_SCOPED_KEYS } from '../settings/tab-scope';
import { CloudVendorError } from '../translation/cloud/vendor';
import { createLimiter } from '../core/concurrency';
import { applyDefaultsToTabs, attachTab, forgetTab, readTab, updateTab } from './tab-settings';
import {
  acquireLease,
  leaseStatus,
  releaseLease,
  releaseTabLeases,
  renewLease,
  type LeaseProgress,
} from './translation-leases';

/**
 * Cloud batches from every tab share one API key and so one rate limit. A small
 * cap keeps several tabs translating at once from tripping it; each tab still
 * makes steady progress because the queue is first come, first served.
 */
const MAX_CONCURRENT_CLOUD_BATCHES = 3;
const limitCloudBatch = createLimiter(MAX_CONCURRENT_CLOUD_BATCHES);

type Sender = chrome.runtime.MessageSender;

const isExtensionPage = (sender: Sender) => sender.url?.startsWith(chrome.runtime.getURL('')) ?? false;

/** The tab a content script runs in; extension pages have none of their own. */
function contentTab(sender: Sender): number {
  if (isExtensionPage(sender) || typeof sender.tab?.id !== 'number' || sender.tab.id < 0) {
    throw new Error('Not allowed');
  }
  return sender.tab.id;
}

const tabIdFrom = (value: unknown): number => {
  if (typeof value !== 'number' || !Number.isInteger(value) || value < 0) throw new TypeError('Invalid tab id');
  return value;
};

const LEASE_ID = /^[\w:-]{1,128}$/;
const leaseId = (value: unknown, what: string): string => {
  if (typeof value !== 'string' || !LEASE_ID.test(value)) throw new TypeError(`Invalid ${what}`);
  return value;
};

const fraction = (value: unknown) =>
  typeof value === 'number' && Number.isFinite(value) ? Math.min(1, Math.max(0, value)) : undefined;
const count = (value: unknown) =>
  typeof value === 'number' && Number.isInteger(value) && value >= 0 ? value : undefined;

const leaseProgress = (value: unknown): LeaseProgress => {
  const v = (value && typeof value === 'object' ? value : {}) as Record<string, unknown>;
  const progress = fraction(v.progress);
  const completedCues = count(v.completedCues);
  const totalCues = count(v.totalCues);
  return {
    ...(progress !== undefined ? { progress } : {}),
    ...(completedCues !== undefined ? { completedCues } : {}),
    ...(totalCues !== undefined ? { totalCues } : {}),
  };
};

async function routeTabSettings(request: Record<string, unknown>, sender: Sender): Promise<unknown> {
  switch (request.type) {
    // Content scripts only ever address their own tab.
    case 'TAB_SETTINGS_ATTACH': return attachTab(contentTab(sender));
    case 'TAB_SETTINGS_UPDATE': {
      const tabId = isExtensionPage(sender) ? tabIdFrom(request.tabId) : contentTab(sender);
      return updateTab(tabId, sanitizeTabPatch(request.patch));
    }
    case 'TAB_SETTINGS_GET':
      if (!isExtensionPage(sender)) throw new Error('Not allowed');
      return readTab(tabIdFrom(request.tabId));
    case 'TAB_SETTINGS_APPLY_DEFAULTS': {
      if (!isExtensionPage(sender) || !Array.isArray(request.keys)) throw new Error('Not allowed');
      const requested: unknown[] = request.keys;
      return applyDefaultsToTabs(TAB_SCOPED_KEYS.filter((key) => requested.includes(key)));
    }
  }
  throw new Error('Unknown request');
}

async function routeLease(request: Record<string, unknown>, sender: Sender): Promise<unknown> {
  const tabId = contentTab(sender);
  const cacheKey = leaseId(request.cacheKey, 'cache key');
  switch (request.type) {
    case 'TRANSLATION_LEASE_ACQUIRE':
      return acquireLease(cacheKey, {
        holder: leaseId(request.holder, 'lease holder'),
        tabId,
        frameId: sender.frameId ?? 0,
        documentId: sender.documentId,
      });
    case 'TRANSLATION_LEASE_RENEW':
      return renewLease(cacheKey, leaseId(request.holder, 'lease holder'), leaseProgress(request.progress));
    case 'TRANSLATION_LEASE_RELEASE':
      return releaseLease(cacheKey, leaseId(request.holder, 'lease holder'));
    case 'TRANSLATION_LEASE_STATUS':
      return leaseStatus(cacheKey);
  }
  throw new Error('Unknown request');
}

chrome.tabs.onRemoved.addListener((tabId) => {
  void forgetTab(tabId);
  void releaseTabLeases(tabId);
});

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
  if (request.type.startsWith('TAB_SETTINGS_') || request.type.startsWith('TRANSLATION_LEASE_')) {
    const message = request as unknown as Record<string, unknown>;
    const route = request.type.startsWith('TAB_SETTINGS_') ? routeTabSettings : routeLease;
    route(message, sender).then(
      (value) => sendResponse({ ok: true, value }),
      (error: unknown) => sendResponse({ ok: false, error: error instanceof Error ? error.message : String(error) }),
    );
    return true;
  }
  if (request.type === 'OPEN_OPTIONS') {
    void chrome.runtime.openOptionsPage();
    return false;
  }
  if (request.type === 'TRANSLATE_AVAILABILITY' || request.type === 'TRANSLATE_BATCH' || request.type === 'TRANSLATE_MODELS') {
    // Model listing is an options-page concern; content scripts have no use for it.
    const fromExtensionPage = isExtensionPage(sender);
    void (async () => {
      switch (request.type) {
        case 'TRANSLATE_AVAILABILITY': return translateAvailability();
        case 'TRANSLATE_MODELS':
          if (!fromExtensionPage) throw new Error('Not allowed');
          return translateModels();
        default: return limitCloudBatch(() => translateBatch(request));
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
