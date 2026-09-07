import type { CachedTranslation, SubtitleTrack } from '../subtitles/models';

export type CacheRequest =
  | { type: 'CACHE_GET_TRANSLATION'; cacheKey: string }
  | { type: 'CACHE_PUT_TRANSLATION'; record: CachedTranslation }
  | { type: 'CACHE_PUT_SOURCE'; track: SubtitleTrack }
  | { type: 'CACHE_GET_SOURCE'; sourceHash: string }
  | { type: 'CACHE_CLEAR' }
  | { type: 'CACHE_STATS' };

export async function sendCacheMessage<T>(message: CacheRequest): Promise<T> {
  const response = await chrome.runtime.sendMessage(message);
  if (!response?.ok) throw new Error(response?.error ?? 'Cache operation failed');
  return response.value as T;
}
