import type { Element } from 'hast';

/**
 * A single entry stored in (or retrieved from) the cache.
 *
 * A `null` `title` is a deliberate "we tried and got nothing / it failed"
 * marker so that the same URL is not re-fetched repeatedly within `failureTtl`.
 */
export interface CacheEntry {
  /** The resolved page title, or `null` if the lookup failed or yielded no title. */
  title: string | null;
  /** ISO-8601 timestamp of when the entry was written. */
  updatedAt: string;
}

/**
 * Pluggable cache interface.
 *
 * Implementations may be sync or async — every method's return value is
 * `await`-ed by the plugin. This keeps the interface trivial to implement
 * for in-memory, file-based, or remote-storage backends alike.
 *
 * TTL/staleness handling is performed by the plugin itself, so cache
 * implementations only need to be a dumb key/value store.
 */
export interface Cache {
  /** Returns the entry for `url`, or `undefined` if not present. */
  get(url: string): Promise<CacheEntry | undefined> | CacheEntry | undefined;
  /** Stores (or overwrites) the entry for `url`. */
  set(url: string, entry: CacheEntry): Promise<void> | void;
  /** Optional: remove an entry. Called by the plugin when an entry expires. */
  delete?(url: string): Promise<void> | void;
}

/** Options forwarded to the internal HTTP client. */
export interface FetchOptions {
  /** Per-request timeout in milliseconds. Default: 5000. */
  timeout?: number;
  /**
   * `User-Agent` header value sent on every request.
   * Default: `'Mozilla/5.0 (compatible; TitleFetcher/1.0)'`.
   */
  userAgent?: string;
  /** Optional `AbortSignal` to cancel the request. */
  signal?: AbortSignal;
}

/**
 * Predicate that decides whether a given `<a>` element should be processed.
 *
 * Sätteri hands visitors frozen nodes, hence `Readonly<Element>`.
 *
 * Defaults to: href starts with `http://` or `https://`.
 */
export type LinkPredicate = (href: string, node: Readonly<Element>) => boolean;

/** A non-fatal problem encountered while resolving a title. */
export interface Warning {
  /** Human-readable description, already prefixed with the plugin name. */
  message: string;
  /** The URL being resolved when the problem occurred. */
  url: string;
  /** The originating error, when there was one. */
  cause?: unknown;
}

/** Configuration for the framework-agnostic title resolver. */
export interface ResolverOptions {
  /**
   * Cache configuration.
   *
   * - `undefined` (default): use the built-in lowdb cache at `./db.titles.json`
   *   (relative to `process.cwd()`).
   * - `string`: path to the JSON cache file; the built-in lowdb cache is used
   *   at that path.
   * - {@link Cache}: a user-provided cache implementation.
   */
  cache?: string | Cache;

  /**
   * Time-to-live for **successful** cache entries, in milliseconds.
   *
   * Entries older than this are treated as missing and refetched.
   *
   * Default: `Infinity` (entries never expire).
   */
  ttl?: number;

  /**
   * Time-to-live for **failed** cache entries (entries with `title === null`),
   * in milliseconds.
   *
   * - `0`: never cache failures (always retry).
   * - `Infinity`: cache failures forever.
   *
   * Default: `86_400_000` (24 hours).
   */
  failureTtl?: number;

  /**
   * Maximum number of concurrent outbound HTTP requests.
   *
   * Scoped to the plugin instance, not to a document: Sätteri calls the
   * exported factory once, so a single limiter covers every document in the
   * build. (The rehype predecessor capped per document instead.)
   *
   * Default: `8`.
   */
  concurrency?: number;

  /** Options forwarded to the internal HTTP client. */
  fetch?: FetchOptions;

  /**
   * Called for every non-fatal problem: a failed fetch, or a cache backend
   * that threw. Fires once per URL, since resolution is deduplicated across
   * the whole build.
   *
   * Default: `console.warn(warning.message)`, so failures stay visible in an
   * `astro build`. Pass a no-op to silence, or route into your own logger.
   *
   * (Sätteri's `ctx.report()` is not a substitute: as of `satteri@0.10.5` the
   * diagnostics it collects are discarded rather than returned with the
   * compile result.)
   */
  onWarning?: (warning: Warning) => void;
}

/** Plugin configuration. */
export interface Options extends ResolverOptions {
  /**
   * Predicate to decide which `<a>` elements are considered "external" and
   * should be processed.
   *
   * Default: href starts with `http://` or `https://`.
   */
  test?: LinkPredicate;

  /**
   * Name of the HTML attribute to set on the link element.
   * Default: `'title'`.
   */
  attribute?: string;

  /**
   * If `true`, also writes a `data-title-updated-at` attribute containing the
   * ISO timestamp of the cache entry. Useful for debugging / cache inspection.
   *
   * Default: `true`.
   */
  includeUpdatedAt?: boolean;
}
