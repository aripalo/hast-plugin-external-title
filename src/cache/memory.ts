import type { Cache, CacheEntry } from '../types.js';

/**
 * Creates a simple in-memory `Cache` backed by a `Map`.
 *
 * Useful for tests, for short-lived processes, and as the default per-run
 * dedupe cache used internally by the plugin.
 */
export function memoryCache(): Cache {
  const store = new Map<string, CacheEntry>();

  return {
    get(url) {
      return store.get(url);
    },
    set(url, entry) {
      store.set(url, entry);
    },
    delete(url) {
      store.delete(url);
    },
  };
}
