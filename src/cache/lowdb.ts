import { JSONFilePreset } from 'lowdb/node';
import type { Low } from 'lowdb';
import type { Cache, CacheEntry } from '../types.js';

/** On-disk JSON shape: a flat URL → {@link CacheEntry} map. */
export type LowdbCacheData = Record<string, CacheEntry>;

/** Default cache file path (relative to `process.cwd()`). */
export const DEFAULT_LOWDB_PATH = 'db.titles.json';

/** Options for {@link lowdbCache}. */
export interface LowdbCacheOptions {
  /**
   * Path to the JSON cache file. Defaults to `'db.titles.json'` (relative to
   * `process.cwd()`).
   */
  path?: string;
}

/**
 * Creates a `Cache` backed by [lowdb](https://github.com/typicode/lowdb)
 * (a single JSON file).
 *
 * The underlying `lowdb` instance is created lazily on first access so that
 * the plugin can be safely imported in environments where top-level `await`
 * is not available, and so that no file I/O happens at import time.
 */
export function lowdbCache(options: LowdbCacheOptions = {}): Cache {
  const filename = options.path ?? DEFAULT_LOWDB_PATH;

  // Lazy initialization: only open the file the first time the cache is used.
  let dbPromise: Promise<Low<LowdbCacheData>> | undefined;

  function getDb(): Promise<Low<LowdbCacheData>> {
    if (!dbPromise) {
      dbPromise = JSONFilePreset<LowdbCacheData>(filename, {});
    }
    return dbPromise;
  }

  return {
    async get(url) {
      const db = await getDb();
      return db.data[url];
    },

    async set(url, entry) {
      const db = await getDb();
      db.data[url] = entry;
      await db.write();
    },

    async delete(url) {
      const db = await getDb();
      if (url in db.data) {
        delete db.data[url];
        await db.write();
      }
    },
  };
}
