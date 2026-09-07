import 'fake-indexeddb/auto';
import { webcrypto } from 'node:crypto';

Object.defineProperty(globalThis, 'crypto', { value: webcrypto, configurable: true });
if (!globalThis.requestAnimationFrame) {
  globalThis.requestAnimationFrame = (callback) => setTimeout(() => callback(performance.now()), 0) as unknown as number;
  globalThis.cancelAnimationFrame = (id) => clearTimeout(id);
}

Object.defineProperty(globalThis, 'chrome', {
  configurable: true,
  writable: true,
  value: {
    i18n: { getUILanguage: () => 'en-US' },
    storage: {
      local: { get: async () => ({}), set: async () => undefined },
      onChanged: { addListener: () => undefined, removeListener: () => undefined },
    },
  },
});
