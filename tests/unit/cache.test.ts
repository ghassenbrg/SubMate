import { describe, expect, it } from 'vitest';
import { cacheStats, clearCache, getSource, getTranslation, putSource, putTranslation } from '../../src/cache/db';
import { sourceTrack } from './validation.test';

describe('IndexedDB cache', () => {
  it('stores exact source and translation records and clears them', async () => {
    await clearCache();
    const source = sourceTrack();
    await putSource(source);
    expect(await getSource(source.sourceHash)).toEqual(source);
    const record = { sourceHash: source.sourceHash, sourceLanguage: 'de', targetLanguage: 'en', engine: { id: 'fake', version: '1' }, translations: [{ id: 'c000001', text: 'Hello' }, { id: 'c000002', text: 'World' }], cacheKey: 'key-exact', createdAt: 1, lastUsedAt: 1 };
    await putTranslation(record);
    expect((await getTranslation('key-exact'))?.targetLanguage).toBe('en');
    expect(await getTranslation('different-target-key')).toBeUndefined();
    expect(await cacheStats()).toEqual({ translations: 1, sources: 1 });
    await clearCache();
    expect(await cacheStats()).toEqual({ translations: 0, sources: 0 });
  });
});
