import { defineHastPlugin } from 'satteri';

import { createTitleResolver } from './resolver.js';
import { lowdbCache } from './cache/lowdb.js';
import { memoryCache } from './cache/memory.js';
import type { LinkPredicate, Options } from './types.js';

export type {
  Cache,
  CacheEntry,
  FetchOptions,
  LinkPredicate,
  Options,
  ResolverOptions,
  Warning,
} from './types.js';
export { lowdbCache, memoryCache };
export { createTitleResolver } from './resolver.js';
export type { TitleResolver } from './resolver.js';

/** Plugin name, as reported to Sätteri and used to prefix warnings. */
export const PLUGIN_NAME = 'hast-plugin-external-title';

/** Attribute holding the cache entry's timestamp when `includeUpdatedAt`. */
const UPDATED_AT_ATTRIBUTE = 'data-title-updated-at';

/** Default predicate: matches absolute `http(s)://` URLs. */
const defaultTest: LinkPredicate = (href) =>
  href.startsWith('https://') || href.startsWith('http://');

/** Shape of a plain HTML attribute name. */
const ATTRIBUTE_NAME = /^[a-zA-Z][a-zA-Z0-9-]*$/;

/**
 * Attributes that must never receive a fetched title.
 *
 * Titles come from third-party servers, so the target attribute has to be
 * inert. These are not: `href`/`src`-style attributes would repoint the link
 * at remote-controlled text, and `style` would hand it the CSS parser. Any
 * `on*` attribute is rejected separately — those are executable.
 */
const UNSAFE_ATTRIBUTES = new Set([
  'action',
  'background',
  'data',
  'formaction',
  'href',
  'poster',
  'src',
  'srcdoc',
  'srcset',
  'style',
]);

/**
 * Validates the `attribute` option.
 *
 * Checked once, when the plugin is created, so a misconfiguration surfaces
 * while reading the config rather than as mysterious markup much later.
 */
function assertSafeAttribute(attribute: string): void {
  if (!ATTRIBUTE_NAME.test(attribute)) {
    throw new Error(
      `${PLUGIN_NAME}: invalid attribute name ${JSON.stringify(attribute)}`
    );
  }
  if (
    attribute.toLowerCase().startsWith('on') ||
    UNSAFE_ATTRIBUTES.has(attribute.toLowerCase())
  ) {
    throw new Error(
      `${PLUGIN_NAME}: refusing to write fetched titles to ${JSON.stringify(
        attribute
      )}, which would let a third-party page inject script or change the link target`
    );
  }
}

/**
 * Sätteri hast plugin that fetches the page title of external links and writes
 * it as the link's `title` attribute (with pluggable caching).
 *
 * The visitor is async, so a compile using this plugin returns a promise —
 * `await` the result of `markdownToHtml` / `mdxToJs` / `markdownToJs`.
 *
 * All state (cache handle, resolved titles, concurrency gate) lives on the
 * instance this factory returns. Sätteri calls the factory once, so a URL
 * appearing across many documents is fetched exactly once per build.
 *
 * @example Astro v7
 * ```js
 * import {defineConfig} from 'astro/config'
 * import {satteri} from '@astrojs/markdown-satteri'
 * import externalTitle from 'hast-plugin-external-title'
 *
 * export default defineConfig({
 *   markdown: {
 *     processor: satteri({
 *       hastPlugins: [externalTitle({cache: '.cache/titles.json'})]
 *     })
 *   }
 * })
 * ```
 *
 * @example Standalone
 * ```ts
 * import {markdownToHtml} from 'satteri'
 * import externalTitle from 'hast-plugin-external-title'
 *
 * const {html} = await markdownToHtml('[x](https://example.com)', {
 *   hastPlugins: [externalTitle()]
 * })
 * ```
 */
export function hastPluginExternalTitle(options: Options = {}) {
  const resolver = createTitleResolver(options);
  const test = options.test ?? defaultTest;
  const attribute = options.attribute ?? 'title';
  const includeUpdatedAt = options.includeUpdatedAt ?? true;

  assertSafeAttribute(attribute);

  return defineHastPlugin({
    name: PLUGIN_NAME,
    element: {
      filter: ['a'],
      async visit(node, ctx) {
        // Read every field up front: a node held across an await reads as the
        // tree looked during its own pass, so don't touch it again after.
        const href = node.properties.href;
        if (typeof href !== 'string') return;
        if (!test(href, node)) return;

        const entry = await resolver.resolve(href);

        if (entry.title === null) {
          // Reported per node so every affected document carries the signal,
          // even though the underlying fetch happened (and warned) once.
          ctx.report({
            message: `${PLUGIN_NAME}: no title available for ${href}`,
            node,
            severity: 'warning',
          });
          return;
        }

        ctx.setProperty(node, attribute, entry.title);
        if (includeUpdatedAt) {
          ctx.setProperty(node, UPDATED_AT_ATTRIBUTE, entry.updatedAt);
        }
      },
    },
  });
}

export default hastPluginExternalTitle;
