# hast-plugin-external-title

[**Sätteri**][satteri] hast plugin that fetches the page `<title>` of every
external link in your Markdown and writes it to the link's `title` attribute
(so users see the destination's real name when they hover the link), with a
pluggable caching layer.

Built for [Astro][] v7+, which processes Markdown and MDX with Sätteri instead
of unified/remark/rehype.

## Contents

- [What is this?](#what-is-this)
- [When should I use this?](#when-should-i-use-this)
- [Install](#install)
- [Use](#use)
- [API](#api)
  - [`externalTitle(options?)`](#externaltitleoptions)
  - [`Options`](#options)
  - [`Cache`](#cache)
  - [Built-in caches](#built-in-caches)
- [Warnings](#warnings)
- [Caching and scope](#caching-and-scope)
- [Fetching](#fetching)
- [Examples](#examples)
- [Limitations](#limitations)
- [Types](#types)
- [Compatibility](#compatibility)
- [Security](#security)
- [Migrating from `rehype-external-link-title`](#migrating-from-rehype-external-link-title)
- [License](#license)

## What is this?

This is a [Sätteri][satteri] [hast plugin][satteri-plugins]. It subscribes to
`a` elements only — Sätteri filters by tag name in Rust, so no other node
crosses into JavaScript — and for each external anchor (by default: `href`
starting with `http://` or `https://`) it fetches the URL, parses the `<title>`
element from the response, and writes it onto the anchor as a `title`
attribute.

To avoid hammering remote servers (and to keep your build times reasonable),
results are persisted to a cache. The cache is **pluggable**: a default
[lowdb][]-backed JSON file is provided out of the box, and you can swap in
your own backend (Redis, KV, in-memory, etc.) by implementing a tiny
two-method interface.

## When should I use this?

Use this plugin if you publish content with many external references — blog
posts, link round-ups, documentation — and you want hover tooltips to display
the actual page title rather than the raw URL.

You probably **shouldn't** use it if:

- Your build runs in a sandbox without outbound network access.
- You don't trust the remote pages and don't want to render their titles (see
  [Security](#security)).
- Build performance is more important than hover-over UX (the first build
  fetches every link; subsequent builds are cache hits).

## Install

This package is [ESM only][esm]. In Node.js (version 20.19+):

```sh
npm install hast-plugin-external-title
```

```sh
pnpm add hast-plugin-external-title
```

[`satteri`][satteri] is a peer dependency. If you are using Astro v7+ it is
already installed via `@astrojs/markdown-satteri`.

## Use

### Astro v7+

```js
// astro.config.mjs
import {defineConfig} from 'astro/config'
import {satteri} from '@astrojs/markdown-satteri'
import externalTitle from 'hast-plugin-external-title'

export default defineConfig({
  markdown: {
    processor: satteri({
      hastPlugins: [externalTitle({cache: '.cache/titles.json'})]
    })
  }
})
```

### Standalone

Say we have the following Markdown:

```md
Read more on [example.com](https://example.com).
```

…and a script `example.js`:

```js
import {markdownToHtml} from 'satteri'
import externalTitle from 'hast-plugin-external-title'

const {html} = await markdownToHtml(
  'Read more on [example.com](https://example.com).',
  {hastPlugins: [externalTitle()]}
)

console.log(html)
```

…running `node example.js` yields (assuming the page's title is `Example Domain`):

```html
<p>Read more on <a href="https://example.com" title="Example Domain" data-title-updated-at="2026-04-19T00:00:00.000Z">example.com</a>.</p>
```

> [!IMPORTANT]
> This plugin's visitor is **async**, which makes the whole compile async.
> `await` the result of `markdownToHtml` / `mdxToJs` / `markdownToJs`. The
> types reflect this: with this plugin registered, the return type is a
> `Promise`.

## API

The plugin factory is both the default export and the named export
`hastPluginExternalTitle`. The examples in this README import it as
`externalTitle` for brevity:

```ts
import externalTitle from 'hast-plugin-external-title'
// equivalently:
import {hastPluginExternalTitle} from 'hast-plugin-external-title'
```

This package additionally exports `lowdbCache`, `memoryCache`,
`createTitleResolver`, `PLUGIN_NAME`, and the TypeScript types `Cache`,
`CacheEntry`, `FetchOptions`, `LinkPredicate`, `Options`, `ResolverOptions`,
`TitleResolver`, and `Warning`.

### `externalTitle(options?)`

Creates the plugin definition to pass to Sätteri's `hastPlugins`.

###### Parameters

- `options` ([`Options`](#options), optional) — configuration

###### Returns

A Sätteri hast plugin definition (`HastPluginDefinition`), with an async
`element` visitor filtered to `a`.

Call it **once** and reuse the result — see [Caching and
scope](#caching-and-scope).

### `Options`

Configuration (TypeScript type).

| Field              | Type                            | Default                 | Description                                                                                                        |
| ------------------ | ------------------------------- | ----------------------- | ------------------------------------------------------------------------------------------------------------------ |
| `cache`            | `string \| Cache`               | built-in `lowdbCache()` | `undefined`: lowdb at `./db.titles.json`. `string`: lowdb at the given path. `Cache`: your own implementation.      |
| `ttl`              | `number`                        | `Infinity`              | TTL for **successful** entries, in ms. An entry exactly `ttl` old is still considered fresh.                        |
| `failureTtl`       | `number`                        | `86_400_000` (24 h)     | TTL for **failed** entries (`title === null`), in ms. Use `0` to never cache failures, `Infinity` to cache forever. |
| `test`             | `(href, node) => boolean`       | `http(s)://...`         | Predicate deciding which `<a>` elements to process. `node` is a **frozen** hast `Element`.                          |
| `attribute`        | `string`                        | `'title'`               | Attribute name written on the link element.                                                                        |
| `includeUpdatedAt` | `boolean`                       | `true`                  | Whether to also write `data-title-updated-at` (ISO timestamp).                                                     |
| `concurrency`      | `number`                        | `8`                     | Maximum concurrent outbound fetches **per plugin instance** — see [Caching and scope](#caching-and-scope).          |
| `fetch`            | `FetchOptions`                  | see below               | Options forwarded to the internal HTTP client (`timeout`, `userAgent`, `signal`, `maxBytes`) — see [Fetching](#fetching). |
| `onWarning`        | `(warning: Warning) => void`    | `console.warn`          | Called for failed fetches and cache errors — see [Warnings](#warnings).                                            |

### `Cache`

The plugin treats the cache as a dumb key/value store. TTL/staleness handling
is performed by the plugin itself, so cache implementations stay trivial:

```ts
export interface CacheEntry {
  title: string | null  // `null` = "we tried and got nothing"
  updatedAt: string     // ISO-8601
}

export interface Cache {
  get(url: string): Promise<CacheEntry | undefined> | CacheEntry | undefined
  set(url: string, entry: CacheEntry): Promise<void> | void
  delete?(url: string): Promise<void> | void  // optional
}
```

Both sync and async return values are supported, so a `Map`-backed cache or a
Redis-backed cache are equally easy to write.

### Built-in caches

```ts
import {lowdbCache, memoryCache} from 'hast-plugin-external-title/cache'

const persistent = lowdbCache({path: '.cache/titles.json'})
const ephemeral  = memoryCache()
```

- **`lowdbCache(options?: {path?: string})`** — JSON file backed by [lowdb][].
  The file is opened lazily on first use (no top-level I/O).
- **`memoryCache()`** — `Map`-backed; useful for tests or short-lived processes.

## Warnings

A link whose page cannot be fetched is not an error: the anchor is left
untouched, the failure is cached (see `failureTtl`), and the build continues.
You still want to know about it, so failures are reported through two channels:

1. **`onWarning`** — the primary channel. Fires once per URL, with the
   underlying cause. It defaults to `console.warn`, so problems are visible in
   an `astro build`:

   ```text
   hast-plugin-external-title: failed to fetch title for https://example.com: HTTP 503: Service Unavailable
   ```

   Pass `onWarning: () => {}` to silence it, or route it into your own logger:

   ```ts
   externalTitle({
     onWarning: ({message, url, cause}) => myLogger.warn({message, url, cause})
   })
   ```

2. **`ctx.report()`** — Sätteri's own diagnostic channel, called once per
   affected anchor per document with `severity: 'warning'`. This is deliberate
   belt-and-braces: because resolution is deduplicated across the whole build,
   a single failing URL is *observed* once but *affects* every document that
   links to it.

> [!NOTE]
> As of `satteri@0.10.5`, diagnostics passed to `ctx.report()` are collected
> and then discarded — they are not returned with the compile result and not
> logged. That is why `onWarning` exists and why it is not silent by default.
> The `ctx.report()` call is kept so this plugin reports properly the day
> Sätteri surfaces diagnostics.

## Caching and scope

Sätteri calls your plugin factory **once**, and reuses the definition for every
document. All of this plugin's state lives on the instance that
`externalTitle()` returns:

- the cache handle,
- an in-memory map of already-resolved titles,
- an in-flight map that collapses concurrent requests for the same URL,
- the concurrency limiter.

So a URL linked from fifty pages is fetched **once per build**, and
`concurrency` is a cap for the whole build rather than for a single document.
(Its rehype predecessor scoped both of these per document.)

The practical consequence: create the plugin once, at config load, which is
what the Astro example above does. If you register two separate instances, each
gets its own limiter and its own in-memory dedupe — pass both the *same* `Cache`
instance if you want them to share persisted results.

An async visitor is entered for every matched anchor before any of them
resolves, so the limiter — not the visitor — is what bounds outbound requests.
Without it, a page with 200 links would issue 200 simultaneous fetches.

## Fetching

Only the `<title>` is ever used, and it lives in `<head>`, so requests are kept
deliberately small:

- **Content type is checked first.** Only `text/html` and
  `application/xhtml+xml` are read. Anything else — including a response with
  no `Content-Type` header at all — is treated as a failure, and **not one byte
  of the body is consumed**. This keeps PDFs, images and downloads out of the
  HTML parser entirely.
- **Reading stops at the end of the head.** As soon as a complete `<title>`
  element or a closing `</head>` arrives, the read stops. On a page with a
  large body this transfers a small fraction of the bytes, which bounds both
  memory and the cost of parsing. Nothing is appended to the partial document —
  HTML parsers close open elements at end-of-input on their own.
- **`maxBytes` (default 256 KiB) is a backstop**, not the main mechanism. It
  only matters for a malformed document that never closes its head. The bound
  is approximate — reading stops after the chunk that crosses the threshold —
  and it is clamped to `[1 KiB, 1 MiB]`, because the stop-marker search costs
  roughly the square of it.
- **`timeout` (default 5 s) is a total deadline** covering the response headers
  *and* the body read. A server that sends headers and then stalls mid-body is
  bounded by it too.
- **`signal` is honored in addition to `timeout`.** Because plugin options are
  reused for the whole build, treat it as a build-wide cancellation switch: once
  it aborts, every later request fails as well.

Redirects follow `fetch`'s defaults. The cache key is the href as written, so a
redirect chain does not fragment the cache.

## Examples

### Custom cache path

```ts
externalTitle({cache: '.cache/external-link-titles.json'})
```

### Refetch every entry older than a week

```ts
externalTitle({ttl: 7 * 24 * 60 * 60 * 1000})
```

### Bring your own cache (Redis-style)

```ts
import type {Cache, CacheEntry} from 'hast-plugin-external-title'

const redisCache: Cache = {
  async get(url) {
    const raw = await redis.get(`title:${url}`)
    return raw ? (JSON.parse(raw) as CacheEntry) : undefined
  },
  async set(url, entry) {
    await redis.set(`title:${url}`, JSON.stringify(entry))
  },
  async delete(url) {
    await redis.del(`title:${url}`)
  }
}

externalTitle({cache: redisCache})
```

### Custom User-Agent

```ts
externalTitle({
  fetch: {userAgent: 'MyCoolBlog/1.0 (+https://example.com/about)'}
})
```

### Process only a subset of links

```ts
externalTitle({
  test: (href) => href.startsWith('https://en.wikipedia.org/')
})
```

## Limitations

- **Raw HTML anchors are ignored unless you opt in.** By default Sätteri keeps
  inline HTML as an opaque `raw` node, so an author-written
  `<a href="https://example.com">` is passed through untouched and this plugin
  never sees it. To have those anchors processed too, enable the parser feature:

  ```js
  processor: satteri({
    features: {rawHtml: true},
    hastPlugins: [externalTitle()]
  })
  ```

  Markdown link syntax (`[text](url)`) works either way.
- **MDX JSX anchors are not processed.** `<a href="…">` in MDX becomes an
  `mdxJsxTextElement` carrying `attributes`, not an `element` with
  `properties`. Only real hast elements are visited.
- **"External" is a string prefix test, not an origin comparison.** Absolute
  links to your own domain are fetched too. Use `test` to exclude them.
- **A link with no resolvable title gets no attributes at all** — not even
  `data-title-updated-at` — so downstream code cannot distinguish "not
  processed" from "processed, found nothing".
- **The cache key is the href as written.** Two URLs that redirect to the same
  page are cached separately.
- **A `<title>` outside `<head>` is not found.** Reading stops at the end of the
  head (see [Fetching](#fetching)), so a title misplaced in the body is missed.
- **A response with no `Content-Type` is treated as a failure**, and negatively
  cached for `failureTtl`. Set `failureTtl: 0` to retry such links every build.

## Types

This package is fully typed with [TypeScript][]. It exports the additional
types `Options`, `ResolverOptions`, `Cache`, `CacheEntry`, `FetchOptions`,
`LinkPredicate`, `TitleResolver`, and `Warning`.

## Compatibility

Compatible with maintained versions of Node.js (>=20.19). Works with
`satteri` 0.10.x and Astro v7+.

## Security

This plugin sets the `title` attribute on `<a>` elements based on data fetched
from third-party servers. `title` is generally not an XSS vector — browsers do
not interpret it as HTML, and Sätteri escapes attribute values on output.

Unlike the rehype ecosystem, Sätteri has no downstream sanitizer equivalent to
`rehype-sanitize`, so the internal sanitization is the whole defense: HTML
returned by remote servers is sanitized with [DOMPurify][] (stripped down to
`<html>`/`<head>`/`<title>` only) before the title is extracted, so malicious
script tags in the source page are discarded before parsing.

Outbound requests are bounded on three axes, described in
[Fetching](#fetching): only HTML content types are read at all, reading stops
at the end of the document's `<head>`, and a single deadline covers the whole
request including the body. For untrusted link sources, prefer a restrictive
`test` predicate on top of that.

## Migrating from `rehype-external-link-title`

This package is the Sätteri successor to `rehype-external-link-title`. The
options are the same except where noted:

| Change | Detail |
| ------ | ------ |
| Registration | `unified().use(plugin, options)` → `satteri({hastPlugins: [externalTitle(options)]})` |
| Async | The compile is now async; `await` the result |
| `test` | The `node` argument is now a **frozen** hast `Element`; mutating it throws |
| `concurrency` | Now capped per plugin instance (per build), not per document |
| Deduplication | Now spans the whole build, not a single document |
| Warnings | `vfile` messages → `onWarning` (defaulting to `console.warn`) plus `ctx.report()` |
| Raw HTML | Requires `features: {rawHtml: true}`; previously handled via `rehype-raw` |
| `fetch.timeout` | Now a total deadline covering headers *and* body, not just the response |
| `fetch.signal` | No longer disables `timeout`; both apply |
| Content type | Only HTML responses are read; a missing `Content-Type` is now a failure |
| Body reads | Stop at the end of `<head>` instead of downloading the whole page |

## License

[MIT][license] © [Ari Palo][author]

[satteri]: https://satteri.bruits.org
[satteri-plugins]: https://satteri.bruits.org/docs/plugins/
[astro]: https://astro.build
[hast]: https://github.com/syntax-tree/hast
[lowdb]: https://github.com/typicode/lowdb
[esm]: https://gist.github.com/sindresorhus/a39789f98801d908bbc7ff3ecc99d99c
[typescript]: https://www.typescriptlang.org
[dompurify]: https://github.com/cure53/DOMPurify
[license]: ./LICENSE
[author]: https://aripalo.technology
