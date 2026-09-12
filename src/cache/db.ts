import type { CachedTranslation, SubtitleTrack } from '../subtitles/models';

const DB_NAME = 'submate-db';
const DB_VERSION = 1;
const SOURCE_STORE = 'sourceSubtitles';
const TRANSLATION_STORE = 'translations';
const CONTENT_STORE = 'contentIndex';

let databasePromise: Promise<IDBDatabase> | undefined;

export function openDatabase(): Promise<IDBDatabase> {
  if (databasePromise) return databasePromise;
  databasePromise = new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, DB_VERSION);
    request.onupgradeneeded = () => {
      const db = request.result;
      if (!db.objectStoreNames.contains(SOURCE_STORE)) db.createObjectStore(SOURCE_STORE, { keyPath: 'sourceHash' });
      if (!db.objectStoreNames.contains(TRANSLATION_STORE)) {
        const store = db.createObjectStore(TRANSLATION_STORE, { keyPath: 'cacheKey' });
        store.createIndex('sourceHash', 'sourceHash');
        store.createIndex('lastUsedAt', 'lastUsedAt');
      }
      if (!db.objectStoreNames.contains(CONTENT_STORE)) db.createObjectStore(CONTENT_STORE, { keyPath: 'contentId' });
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
    request.onblocked = () => reject(new Error('IndexedDB upgrade blocked'));
  });
  return databasePromise;
}

const requestResult = <T>(request: IDBRequest<T>): Promise<T> => new Promise((resolve, reject) => {
  request.onsuccess = () => resolve(request.result);
  request.onerror = () => reject(request.error);
});

const transactionDone = (transaction: IDBTransaction): Promise<void> => new Promise((resolve, reject) => {
  transaction.oncomplete = () => resolve();
  transaction.onerror = () => reject(transaction.error);
  transaction.onabort = () => reject(transaction.error);
});

/**
 * Content-index key. Two platforms can legitimately use the same content id,
 * so the platform is part of the key rather than of the stored track.
 */
export const contentKey = (platform: string, contentId: string): string => `${platform}:${contentId}`;

export async function putSource(track: SubtitleTrack): Promise<void> {
  const db = await openDatabase();
  const transaction = db.transaction([SOURCE_STORE, CONTENT_STORE], 'readwrite');
  transaction.objectStore(SOURCE_STORE).put(track);
  transaction.objectStore(CONTENT_STORE).put({
    contentId: contentKey(track.platform, track.contentId),
    sourceHash: track.sourceHash,
    updatedAt: Date.now(),
  });
  await transactionDone(transaction);
}

export async function getSource(sourceHash: string): Promise<SubtitleTrack | undefined> {
  const db = await openDatabase();
  return requestResult(db.transaction(SOURCE_STORE).objectStore(SOURCE_STORE).get(sourceHash));
}

export async function getSourceForContent(key: string): Promise<SubtitleTrack | undefined> {
  const db = await openDatabase();
  const index = await requestResult<{ contentId: string; sourceHash: string } | undefined>(
    db.transaction(CONTENT_STORE).objectStore(CONTENT_STORE).get(key),
  );
  return index?.sourceHash ? getSource(index.sourceHash) : undefined;
}

export async function putTranslation(record: CachedTranslation): Promise<void> {
  const db = await openDatabase();
  const transaction = db.transaction(TRANSLATION_STORE, 'readwrite');
  transaction.objectStore(TRANSLATION_STORE).put(record);
  await transactionDone(transaction);
}

export async function getTranslation(cacheKey: string): Promise<CachedTranslation | undefined> {
  const db = await openDatabase();
  const transaction = db.transaction(TRANSLATION_STORE, 'readwrite');
  const store = transaction.objectStore(TRANSLATION_STORE);
  const value = await requestResult<CachedTranslation | undefined>(store.get(cacheKey));
  if (value) store.put({ ...value, lastUsedAt: Date.now() });
  await transactionDone(transaction);
  return value;
}

export async function clearCache(): Promise<void> {
  const db = await openDatabase();
  const transaction = db.transaction([SOURCE_STORE, TRANSLATION_STORE, CONTENT_STORE], 'readwrite');
  transaction.objectStore(SOURCE_STORE).clear();
  transaction.objectStore(TRANSLATION_STORE).clear();
  transaction.objectStore(CONTENT_STORE).clear();
  await transactionDone(transaction);
}

export async function cacheStats(): Promise<{ translations: number; sources: number }> {
  const db = await openDatabase();
  const transaction = db.transaction([SOURCE_STORE, TRANSLATION_STORE], 'readonly');
  const [translations, sources] = await Promise.all([
    requestResult(transaction.objectStore(TRANSLATION_STORE).count()),
    requestResult(transaction.objectStore(SOURCE_STORE).count()),
  ]);
  return { translations, sources };
}
