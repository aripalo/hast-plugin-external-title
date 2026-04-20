/**
 * @import {Plugin} from 'unified'
 * @import {Root, Element} from 'hast'
 * @import {VFile} from 'vfile'
 */

import type { Element, Root } from 'hast';
import type { Plugin } from 'unified';
import type { VFile } from 'vfile';
import { visit } from 'unist-util-visit';

import { fetchHtml } from './fetch-html.js';
import { parseTitle } from './parse-title.js';
import { lowdbCache } from './cache/lowdb.js';
import { memoryCache } from './cache/memory.js';
import type {
  Cache,
  CacheEntry,
  LinkPredicate,
  Options,
} from './types.js';

export type {
  Cache,
  CacheEntry,
  FetchOptions,
  LinkPredicate,
  Options,
} from './types.js';
export { lowdbCache, memoryCache };

/** Default predicate: matches absolute `http(s)://` URLs. */
const defaultTest: LinkPredicate = (href) =>
  href.startsWith('https://') || href.startsWith('http://');

/** 24 hours in milliseconds. */
const DEFAULT_FAILURE_TTL = 24 * 60 * 60 * 1000;

/** Default concurrency for outbound HTTP fetches. */
const DEFAULT_CONCURRENCY = 8;

/**
 * Resolves the `cache` option to a concrete {@link Cache} instance.
 *
 * - `undefined` → default lowdb cache at `./db.titles.json`
 * - `string`    → lowdb cache at the given path
 * - {@link Cache} → returned as-is
 */
function resolveCache(option: Options['cache']): Cache {
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
function isExpired(entry: CacheEntry, ttl: number, now: number): boolean {
  if (!Number.isFinite(ttl)) return false;
  if (ttl <= 0) return true;
  const updatedAt = Date.parse(entry.updatedAt);
  if (Number.isNaN(updatedAt)) return true;
  return now - updatedAt > ttl;
}

/**
 * rehype plugin that fetches the page title of external links and writes it
 * as the link's `title` attribute (with pluggable caching).
 *
 * @example
 * ```ts
 * import {unified} from 'unified'
 * import rehypeParse from 'rehype-parse'
 * import rehypeStringify from 'rehype-stringify'
 * import rehypeExternalLinkTitle from 'rehype-external-link-title'
 *
 * const file = await unified()
 *   .use(rehypeParse, {fragment: true})
 *   .use(rehypeExternalLinkTitle, {cache: '.cache/titles.json'})
 *   .use(rehypeStringify)
 *   .process('<a href="https://example.com">x</a>')
 * ```
 */
const rehypeExternalLinkTitle: Plugin<[Options?], Root> = (options = {}) => {
  const cache = resolveCache(options.cache);
  const ttl = options.ttl ?? Number.POSITIVE_INFINITY;
  const failureTtl = options.failureTtl ?? DEFAULT_FAILURE_TTL;
  const test = options.test ?? defaultTest;
  const attribute = options.attribute ?? 'title';
  const includeUpdatedAt = options.includeUpdatedAt ?? true;
  const concurrency = Math.max(1, options.concurrency ?? DEFAULT_CONCURRENCY);
  const fetchOptions = options.fetch ?? {};

  return async function transformer(tree: Root, file: VFile): Promise<undefined> {
    const matches: { node: Element; href: string }[] = [];

    visit(tree, 'element', (node: Element) => {
      if (node.tagName !== 'a') return;
      const href = node.properties?.href;
      if (typeof href !== 'string') return;
      if (!test(href, node)) return;
      matches.push({ node, href });
    });

    if (matches.length === 0) return undefined;

    // Per-run cache: dedupes work for the same URL appearing multiple times
    // within a single document, regardless of the persistent cache backend.
    const runCache = memoryCache();

    // Group matches by href so each unique URL is resolved once per run.
    const byHref = new Map<string, Element[]>();
    for (const { node, href } of matches) {
      const list = byHref.get(href);
      if (list) {
        list.push(node);
      } else {
        byHref.set(href, [node]);
      }
    }

    const hrefs = [...byHref.keys()];
    const now = Date.now();

    async function resolveTitle(href: string): Promise<CacheEntry | undefined> {
      const cached = await runCache.get(href);
      if (cached) return cached;

      let entry: CacheEntry | undefined;

      try {
        entry = await cache.get(href);
      } catch (error) {
        file.message(
          `rehype-external-link-title: cache.get failed for ${href}: ${
            (error as Error).message
          }`
        );
      }

      if (entry) {
        const effectiveTtl = entry.title === null ? failureTtl : ttl;
        if (!isExpired(entry, effectiveTtl, now)) {
          await runCache.set(href, entry);
          return entry;
        }
        if (cache.delete) {
          try {
            await cache.delete(href);
          } catch {
            // best-effort cleanup; ignore
          }
        }
      }

      let title: string | null = null;
      try {
        const html = await fetchHtml(href, fetchOptions);
        title = parseTitle(html);
      } catch (error) {
        file.message(
          `rehype-external-link-title: failed to fetch title for ${href}: ${
            (error as Error).message
          }`
        );
      }

      const fresh: CacheEntry = {
        title,
        updatedAt: new Date().toISOString(),
      };

      try {
        await cache.set(href, fresh);
      } catch (error) {
        file.message(
          `rehype-external-link-title: cache.set failed for ${href}: ${
            (error as Error).message
          }`
        );
      }

      await runCache.set(href, fresh);
      return fresh;
    }

    // Concurrency-bounded URL resolution.
    const results = new Map<string, CacheEntry | undefined>();
    let cursor = 0;

    async function worker(): Promise<void> {
      while (cursor < hrefs.length) {
        const href = hrefs[cursor++]!;
        const entry = await resolveTitle(href);
        results.set(href, entry);
      }
    }

    const workers = Array.from(
      { length: Math.min(concurrency, hrefs.length) },
      () => worker()
    );
    await Promise.all(workers);

    // Apply resolved titles to every matching node.
    for (const [href, nodes] of byHref) {
      const entry = results.get(href);
      if (!entry || entry.title === null) continue;

      for (const node of nodes) {
        node.properties = node.properties ?? {};
        node.properties[attribute] = entry.title;
        if (includeUpdatedAt) {
          node.properties['data-title-updated-at'] = entry.updatedAt;
        }
      }
    }

    return undefined;
  };
};

export default rehypeExternalLinkTitle;
