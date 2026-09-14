/** In-memory `chrome.storage` area with the async surface the worker uses. */
export function fakeStorageArea(initial: Record<string, unknown> = {}) {
  const data: Record<string, unknown> = structuredClone(initial);
  return {
    data,
    get: async (key: string | null) => {
      if (key === null) return structuredClone(data);
      return key in data ? { [key]: structuredClone(data[key]) } : {};
    },
    set: async (items: Record<string, unknown>) => {
      for (const [key, value] of Object.entries(items)) data[key] = structuredClone(value);
    },
    remove: async (key: string) => {
      delete data[key];
    },
  };
}
