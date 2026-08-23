import { fetchHtml } from './fetch-html.js';
import { parseTitle } from './parse-title.js';
import { lowdbCache } from './cache/lowdb.js';
import { createSemaphore } from './semaphore.js';
import type {
  Cache,
  CacheEntry,
  ResolverOptions,
  Warning,
} from './types.js';

/** Prefix on every warning message, so build output is attributable. */
export const WARNING_PREFIX = 'hast-plugin-external-title';

/** 24 hours in milliseconds. */
export const DEFAULT_FAILURE_TTL = 24 * 60 * 60 * 1000;

/** Default concurrency for outbound HTTP fetches. */
export const DEFAULT_CONCURRENCY = 8;

/**
 * Resolves the `cache` option to a concrete {@link Cache} instance.
 *
 * - `undefined` → default lowdb cache at `./db.titles.json`
 * - `string`    → lowdb cache at the given path
 * - {@link Cache} → returned as-is
 */
export function resolveCache(option: ResolverOptions['cache']): Cache {
  if (option === undefined) {
    return lowdbCache();
  }
  if (typeof option === 'string') {
    return lowdbCache({ path: option });
  }
  return option;
}

/**
 * Returns `true` if `entry` is older than `ttl` ms (i.e. should be considered
 * missing). `Infinity` means "never expire".
 */
export function isExpired(
  entry: CacheEntry,
  ttl: number,
  now: number
): boolean {
  if (!Number.isFinite(ttl)) return false;
  if (ttl <= 0) return true;
  const updatedAt = Date.parse(entry.updatedAt);
  if (Number.isNaN(updatedAt)) return true;
  return now - updatedAt > ttl;
}

/** Resolves URLs to page titles, with caching, TTLs and bounded concurrency. */
export interface TitleResolver {
  /**
   * Returns the cache entry for `url`, fetching and parsing the remote page
   * when there is no fresh cached value.
   *
   * Never rejects: a failed lookup resolves to an entry with `title === null`
   * and is reported through `onWarning`.
   */
  resolve(url: string): Promise<CacheEntry>;
}

/**
 * Creates a {@link TitleResolver}.
 *
 * The returned resolver holds all of the plugin's mutable state — the
 * persistent cache handle, an in-memory result map, the in-flight request map
 * and the concurrency gate. It is created once per plugin instance, so a
 * URL appearing in many documents is fetched exactly once per build.
 */
export function createTitleResolver(
  options: ResolverOptions = {}
): TitleResolver {
  const cache = resolveCache(options.cache);
  const ttl = options.ttl ?? Number.POSITIVE_INFINITY;
  const failureTtl = options.failureTtl ?? DEFAULT_FAILURE_TTL;
  const fetchOptions = options.fetch ?? {};
  const semaphore = createSemaphore(options.concurrency ?? DEFAULT_CONCURRENCY);
  const onWarning =
    options.onWarning ??
    ((warning: Warning) => {
      console.warn(warning.message);
    });

  /** Entries already resolved in this process: skips the cache round trip. */
  const resolved = new Map<string, CacheEntry>();

  /** Resolutions currently under way, keyed by URL, so each URL runs once. */
  const inFlight = new Map<string, Promise<CacheEntry>>();

  function warn(url: string, detail: string, cause?: unknown): void {
    onWarning({ message: `${WARNING_PREFIX}: ${detail}`, url, cause });
  }

  /** Reads a fresh entry from the persistent cache, or `undefined`. */
  async function readCache(
    url: string,
    now: number
  ): Promise<CacheEntry | undefined> {
    let entry: CacheEntry | undefined;

    try {
      entry = await cache.get(url);
    } catch (error) {
      warn(url, `cache.get failed for ${url}: ${errorMessage(error)}`, error);
      return undefined;
    }

    if (!entry) return undefined;

    const effectiveTtl = entry.title === null ? failureTtl : ttl;
    if (!isExpired(entry, effectiveTtl, now)) {
      return entry;
    }

    if (cache.delete) {
      try {
        await cache.delete(url);
      } catch {
        // Best-effort cleanup; a backend that cannot evict is not an error.
      }
    }

    return undefined;
  }

  /** Fetches and parses `url`, never throwing. */
  async function fetchEntry(url: string): Promise<CacheEntry> {
    let title: string | null = null;

    try {
      const html = await semaphore.run(() => fetchHtml(url, fetchOptions));
      title = parseTitle(html);
    } catch (error) {
      warn(
        url,
        `failed to fetch title for ${url}: ${errorMessage(error)}`,
        error
      );
    }

    return { title, updatedAt: new Date().toISOString() };
  }

  async function resolveUncached(url: string): Promise<CacheEntry> {
    const cached = await readCache(url, Date.now());
    if (cached) {
      resolved.set(url, cached);
      return cached;
    }

    const fresh = await fetchEntry(url);

    try {
      await cache.set(url, fresh);
    } catch (error) {
      warn(url, `cache.set failed for ${url}: ${errorMessage(error)}`, error);
    }

    resolved.set(url, fresh);
    return fresh;
  }

  return {
    resolve(url) {
      const done = resolved.get(url);
      if (done) return Promise.resolve(done);

      const pending = inFlight.get(url);
      if (pending) return pending;

      const promise = resolveUncached(url).finally(() => {
        inFlight.delete(url);
      });
      inFlight.set(url, promise);
      return promise;
    },
  };
}

/** Extracts a message from an unknown thrown value. */
function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
