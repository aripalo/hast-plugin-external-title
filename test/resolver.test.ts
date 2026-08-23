import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

const mockFetchHtml = vi.fn();
const mockParseTitle = vi.fn();

vi.mock('../src/fetch-html.js', () => ({
  fetchHtml: (...args: unknown[]) => mockFetchHtml(...args),
  DEFAULT_USER_AGENT: 'Mozilla/5.0 (compatible; TitleFetcher/1.0)',
  DEFAULT_TIMEOUT: 5000,
  DEFAULT_MAX_BYTES: 256 * 1024,
}));

vi.mock('../src/parse-title.js', () => ({
  parseTitle: (...args: unknown[]) => mockParseTitle(...args),
}));

// Stub the lowdb cache so constructing a resolver without options performs no
// file I/O.
const mockLowdbGet = vi.fn();
const mockLowdbSet = vi.fn();
const mockLowdbDelete = vi.fn();
vi.mock('../src/cache/lowdb.js', () => ({
  DEFAULT_LOWDB_PATH: 'db.titles.json',
  lowdbCache: vi.fn(() => ({
    get: mockLowdbGet,
    set: mockLowdbSet,
    delete: mockLowdbDelete,
  })),
}));

import {
  createTitleResolver,
  isExpired,
  resolveCache,
  DEFAULT_CONCURRENCY,
  DEFAULT_FAILURE_TTL,
} from '../src/resolver.js';
import { lowdbCache } from '../src/cache/lowdb.js';
import { memoryCache } from '../src/cache/memory.js';
import type { Cache, CacheEntry, ResolverOptions } from '../src/types.js';

/** Creates a resolver whose warnings are captured instead of logged. */
function createHarness(options: ResolverOptions = {}) {
  const warnings: { message: string; url: string; cause?: unknown }[] = [];
  const resolver = createTitleResolver({
    onWarning: (warning) => warnings.push(warning),
    ...options,
  });
  return { resolver, warnings };
}

const DAY = 24 * 60 * 60 * 1000;

describe('isExpired', () => {
  const now = Date.parse('2026-06-01T00:00:00.000Z');
  const entry = (updatedAt: string): CacheEntry => ({ title: 'x', updatedAt });

  it('never expires for a non-finite ttl', () => {
    for (const ttl of [
      Number.POSITIVE_INFINITY,
      Number.NEGATIVE_INFINITY,
      Number.NaN,
    ]) {
      expect(isExpired(entry('2000-01-01T00:00:00.000Z'), ttl, now)).toBe(false);
    }
  });

  it('always expires for a ttl of zero or less', () => {
    expect(isExpired(entry(new Date(now).toISOString()), 0, now)).toBe(true);
    expect(isExpired(entry(new Date(now).toISOString()), -1, now)).toBe(true);
  });

  it('treats an unparseable updatedAt as expired', () => {
    expect(isExpired(entry('not-a-date'), 60_000, now)).toBe(true);
  });

  it('is fresh exactly at the ttl boundary and stale one ms past it', () => {
    const atBoundary = new Date(now - 60_000).toISOString();
    const pastBoundary = new Date(now - 60_001).toISOString();

    expect(isExpired(entry(atBoundary), 60_000, now)).toBe(false);
    expect(isExpired(entry(pastBoundary), 60_000, now)).toBe(true);
  });
});

describe('resolveCache', () => {
  beforeEach(() => {
    vi.mocked(lowdbCache).mockClear();
  });

  it('defaults to the lowdb cache with no arguments', () => {
    resolveCache(undefined);
    expect(lowdbCache).toHaveBeenCalledWith();
  });

  it('passes a string option through as the lowdb path', () => {
    resolveCache('/tmp/custom.json');
    expect(lowdbCache).toHaveBeenCalledWith({ path: '/tmp/custom.json' });
  });

  it('returns a user-provided Cache untouched', () => {
    const cache = memoryCache();
    expect(resolveCache(cache)).toBe(cache);
    expect(lowdbCache).not.toHaveBeenCalled();
  });
});

describe('createTitleResolver', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockLowdbGet.mockResolvedValue(undefined);
    mockLowdbSet.mockResolvedValue(undefined);
    mockLowdbDelete.mockResolvedValue(undefined);
    mockFetchHtml.mockResolvedValue('<html><title>Test Title</title></html>');
    mockParseTitle.mockReturnValue('Test Title');
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  describe('defaults', () => {
    it('exposes the documented default constants', () => {
      expect(DEFAULT_FAILURE_TTL).toBe(DAY);
      expect(DEFAULT_CONCURRENCY).toBe(8);
    });

    it('warns through console.warn when no onWarning is given', async () => {
      const spy = vi.spyOn(console, 'warn').mockImplementation(() => {});
      const resolver = createTitleResolver();
      mockFetchHtml.mockRejectedValueOnce(new Error('offline'));

      await resolver.resolve('https://default-warn.example.com');

      expect(spy).toHaveBeenCalledWith(
        expect.stringContaining('hast-plugin-external-title:')
      );
      expect(spy).toHaveBeenCalledWith(expect.stringContaining('offline'));
      spy.mockRestore();
    });
  });

  describe('cache hits', () => {
    it('returns a fresh cached entry without fetching', async () => {
      const url = 'https://cache-hit.example.com';
      mockLowdbGet.mockResolvedValueOnce({
        title: 'Cached Title',
        updatedAt: '2026-01-01T00:00:00.000Z',
      } satisfies CacheEntry);

      const { resolver } = createHarness();
      const entry = await resolver.resolve(url);

      expect(entry).toEqual({
        title: 'Cached Title',
        updatedAt: '2026-01-01T00:00:00.000Z',
      });
      expect(mockLowdbGet).toHaveBeenCalledWith(url);
      expect(mockFetchHtml).not.toHaveBeenCalled();
    });
  });

  describe('cache miss then fetch', () => {
    it('fetches, parses and stores', async () => {
      const url = 'https://miss.example.com';
      mockFetchHtml.mockResolvedValueOnce('<html><title>Fetched</title></html>');
      mockParseTitle.mockReturnValueOnce('Fetched');

      const { resolver } = createHarness();
      const entry = await resolver.resolve(url);

      expect(mockFetchHtml).toHaveBeenCalledWith(url, {});
      expect(mockParseTitle).toHaveBeenCalledWith(
        '<html><title>Fetched</title></html>'
      );
      expect(mockLowdbSet).toHaveBeenCalledWith(
        url,
        expect.objectContaining({ title: 'Fetched' })
      );
      expect(entry.title).toBe('Fetched');
      expect(Number.isNaN(Date.parse(entry.updatedAt))).toBe(false);
    });

    it('stores a null entry and warns when the fetch rejects', async () => {
      const url = 'https://fetch-fail.example.com';
      mockFetchHtml.mockRejectedValueOnce(new Error('boom'));

      const { resolver, warnings } = createHarness();
      const entry = await resolver.resolve(url);

      expect(entry.title).toBeNull();
      expect(mockLowdbSet).toHaveBeenCalledWith(
        url,
        expect.objectContaining({ title: null })
      );
      expect(warnings).toHaveLength(1);
      expect(warnings[0]!.url).toBe(url);
      expect(warnings[0]!.message).toContain('boom');
      expect((warnings[0]!.cause as Error).message).toBe('boom');
    });

    it('stores a null entry when the parser returns null, without warning', async () => {
      const url = 'https://no-title.example.com';
      mockFetchHtml.mockResolvedValueOnce('<html></html>');
      mockParseTitle.mockReturnValueOnce(null);

      const { resolver, warnings } = createHarness();
      const entry = await resolver.resolve(url);

      expect(entry.title).toBeNull();
      expect(mockLowdbSet).toHaveBeenCalledWith(
        url,
        expect.objectContaining({ title: null })
      );
      expect(warnings).toEqual([]);
    });

    it('handles a non-Error rejection', async () => {
      const url = 'https://weird-throw.example.com';
      mockFetchHtml.mockRejectedValueOnce('just a string');

      const { resolver, warnings } = createHarness();
      const entry = await resolver.resolve(url);

      expect(entry.title).toBeNull();
      expect(warnings[0]!.message).toContain('just a string');
    });

    it('forwards fetch options verbatim', async () => {
      const url = 'https://ua.example.com';
      const { resolver } = createHarness({
        fetch: { userAgent: 'CustomBot/9.9', timeout: 1234 },
      });

      await resolver.resolve(url);

      expect(mockFetchHtml).toHaveBeenCalledWith(url, {
        userAgent: 'CustomBot/9.9',
        timeout: 1234,
      });
    });
  });

  describe('failureTtl', () => {
    it('does not refetch a failure entry within failureTtl', async () => {
      mockLowdbGet.mockResolvedValueOnce({
        title: null,
        updatedAt: new Date().toISOString(),
      });

      const { resolver } = createHarness({ failureTtl: DAY });
      const entry = await resolver.resolve('https://fresh-fail.example.com');

      expect(mockFetchHtml).not.toHaveBeenCalled();
      expect(entry.title).toBeNull();
    });

    it('deletes and refetches a failure entry past failureTtl', async () => {
      const url = 'https://stale-fail.example.com';
      mockLowdbGet.mockResolvedValueOnce({
        title: null,
        updatedAt: new Date(Date.now() - 25 * 60 * 60 * 1000).toISOString(),
      });
      mockFetchHtml.mockResolvedValueOnce('<title>Now Works</title>');
      mockParseTitle.mockReturnValueOnce('Now Works');

      const { resolver } = createHarness({ failureTtl: DAY });
      const entry = await resolver.resolve(url);

      expect(mockLowdbDelete).toHaveBeenCalledWith(url);
      expect(mockFetchHtml).toHaveBeenCalledWith(url, {});
      expect(entry.title).toBe('Now Works');
    });

    it('always retries when failureTtl is 0', async () => {
      mockLowdbGet.mockResolvedValueOnce({
        title: null,
        updatedAt: new Date().toISOString(),
      });
      mockFetchHtml.mockResolvedValueOnce('<title>Fresh</title>');
      mockParseTitle.mockReturnValueOnce('Fresh');

      const { resolver } = createHarness({ failureTtl: 0 });
      const entry = await resolver.resolve('https://no-fail-cache.example.com');

      expect(mockFetchHtml).toHaveBeenCalled();
      expect(entry.title).toBe('Fresh');
    });

    it('defaults failures to a 24 hour ttl', async () => {
      mockLowdbGet.mockResolvedValueOnce({
        title: null,
        updatedAt: new Date(Date.now() - 23 * 60 * 60 * 1000).toISOString(),
      });

      const { resolver } = createHarness();
      await resolver.resolve('https://default-failure-ttl.example.com');

      expect(mockFetchHtml).not.toHaveBeenCalled();
    });
  });

  describe('ttl', () => {
    it('does not refetch within ttl', async () => {
      mockLowdbGet.mockResolvedValueOnce({
        title: 'Fresh',
        updatedAt: new Date().toISOString(),
      });

      const { resolver } = createHarness({ ttl: 60_000 });
      const entry = await resolver.resolve('https://fresh-success.example.com');

      expect(mockFetchHtml).not.toHaveBeenCalled();
      expect(entry.title).toBe('Fresh');
    });

    it('deletes and refetches past ttl', async () => {
      const url = 'https://stale-success.example.com';
      mockLowdbGet.mockResolvedValueOnce({
        title: 'Old',
        updatedAt: new Date(Date.now() - 120_000).toISOString(),
      });
      mockFetchHtml.mockResolvedValueOnce('<title>New</title>');
      mockParseTitle.mockReturnValueOnce('New');

      const { resolver } = createHarness({ ttl: 60_000 });
      const entry = await resolver.resolve(url);

      expect(mockLowdbDelete).toHaveBeenCalledWith(url);
      expect(entry.title).toBe('New');
    });

    it('treats the default Infinity as never-expires', async () => {
      mockLowdbGet.mockResolvedValueOnce({
        title: 'Ancient',
        updatedAt: '2000-01-01T00:00:00.000Z',
      });

      const { resolver } = createHarness();
      const entry = await resolver.resolve('https://infinite-ttl.example.com');

      expect(mockFetchHtml).not.toHaveBeenCalled();
      expect(entry.title).toBe('Ancient');
    });

    it('treats a malformed updatedAt as expired', async () => {
      mockLowdbGet.mockResolvedValueOnce({
        title: 'X',
        updatedAt: 'not-a-date',
      });
      mockFetchHtml.mockResolvedValueOnce('<title>Refreshed</title>');
      mockParseTitle.mockReturnValueOnce('Refreshed');

      const { resolver } = createHarness({ ttl: 60_000 });
      const entry = await resolver.resolve('https://bad-date.example.com');

      expect(mockFetchHtml).toHaveBeenCalled();
      expect(entry.title).toBe('Refreshed');
    });

    it('tolerates a backend with no delete method when an entry expires', async () => {
      const url = 'https://no-delete.example.com';
      const cache: Cache = {
        get: vi
          .fn()
          .mockResolvedValue({ title: 'Old', updatedAt: 'not-a-date' }),
        set: vi.fn().mockResolvedValue(undefined),
      };
      mockFetchHtml.mockResolvedValueOnce('<title>New</title>');
      mockParseTitle.mockReturnValueOnce('New');

      const { resolver, warnings } = createHarness({ cache, ttl: 60_000 });
      const entry = await resolver.resolve(url);

      expect(entry.title).toBe('New');
      expect(warnings).toEqual([]);
    });

    it('swallows a throwing delete during eviction', async () => {
      const url = 'https://delete-throws.example.com';
      const cache: Cache = {
        get: vi
          .fn()
          .mockResolvedValue({ title: 'Old', updatedAt: 'not-a-date' }),
        set: vi.fn().mockResolvedValue(undefined),
        delete: vi.fn().mockRejectedValue(new Error('cannot evict')),
      };
      mockFetchHtml.mockResolvedValueOnce('<title>New</title>');
      mockParseTitle.mockReturnValueOnce('New');

      const { resolver, warnings } = createHarness({ cache, ttl: 60_000 });
      const entry = await resolver.resolve(url);

      expect(entry.title).toBe('New');
      expect(warnings).toEqual([]);
    });
  });

  describe('deduplication', () => {
    it('queries the persistent cache only once per url', async () => {
      const url = 'https://duplicate.example.com';
      mockLowdbGet.mockResolvedValueOnce({
        title: 'Once',
        updatedAt: '2026-01-01T00:00:00.000Z',
      });

      const { resolver } = createHarness();
      const entries = await Promise.all([
        resolver.resolve(url),
        resolver.resolve(url),
        resolver.resolve(url),
      ]);

      expect(mockLowdbGet).toHaveBeenCalledTimes(1);
      expect(entries.map((e) => e.title)).toEqual(['Once', 'Once', 'Once']);
      // Same entry object for every caller.
      expect(entries[1]).toBe(entries[0]);
      expect(entries[2]).toBe(entries[0]);
    });

    it('fetches only once for concurrent callers of the same url', async () => {
      const url = 'https://concurrent-dupe.example.com';
      const { resolver } = createHarness();

      await Promise.all([resolver.resolve(url), resolver.resolve(url)]);

      expect(mockFetchHtml).toHaveBeenCalledTimes(1);
    });

    it('reuses the result across sequential calls, without re-reading the cache', async () => {
      const url = 'https://sequential-dupe.example.com';
      const { resolver } = createHarness();

      const first = await resolver.resolve(url);
      const second = await resolver.resolve(url);

      expect(mockLowdbGet).toHaveBeenCalledTimes(1);
      expect(mockFetchHtml).toHaveBeenCalledTimes(1);
      expect(second).toBe(first);
    });

    it('keeps distinct urls independent', async () => {
      const { resolver } = createHarness();
      mockParseTitle.mockReturnValueOnce('One').mockReturnValueOnce('Two');

      const [one, two] = await Promise.all([
        resolver.resolve('https://one.example.com'),
        resolver.resolve('https://two.example.com'),
      ]);

      expect(mockFetchHtml).toHaveBeenCalledTimes(2);
      expect([one!.title, two!.title].sort()).toEqual(['One', 'Two']);
    });
  });

  describe('cache option resolution', () => {
    it('uses a user-provided Cache', async () => {
      const url = 'https://byo-cache.example.com';
      const cache: Cache = {
        get: vi.fn().mockResolvedValue({
          title: 'From BYO',
          updatedAt: '2026-01-01T00:00:00.000Z',
        }),
        set: vi.fn().mockResolvedValue(undefined),
        delete: vi.fn().mockResolvedValue(undefined),
      };

      const { resolver } = createHarness({ cache });
      const entry = await resolver.resolve(url);

      expect(cache.get).toHaveBeenCalledWith(url);
      expect(mockLowdbGet).not.toHaveBeenCalled();
      expect(entry.title).toBe('From BYO');
    });

    it('accepts a fully synchronous Cache', async () => {
      const url = 'https://sync-cache.example.com';
      const cache: Cache = {
        get: () => ({ title: 'Sync', updatedAt: new Date().toISOString() }),
        set: () => {},
      };

      const { resolver } = createHarness({ cache });
      const entry = await resolver.resolve(url);

      expect(entry.title).toBe('Sync');
    });

    it('writes back to a user-provided cache on miss', async () => {
      const url = 'https://byo-write.example.com';
      const cache = memoryCache();
      mockFetchHtml.mockResolvedValueOnce('<title>Written</title>');
      mockParseTitle.mockReturnValueOnce('Written');

      const { resolver } = createHarness({ cache });
      await resolver.resolve(url);

      expect(await cache.get(url)).toEqual(
        expect.objectContaining({ title: 'Written' })
      );
    });

    it('passes a string cache option to lowdb as a path', () => {
      createTitleResolver({ cache: '/tmp/custom.json' });
      expect(lowdbCache).toHaveBeenCalledWith({ path: '/tmp/custom.json' });
    });
  });

  describe('cache backend failures', () => {
    it('warns and still resolves when cache.get throws', async () => {
      const url = 'https://cache-get-throws.example.com';
      const cache: Cache = {
        get: vi.fn().mockRejectedValue(new Error('disk on fire')),
        set: vi.fn().mockResolvedValue(undefined),
      };
      mockFetchHtml.mockResolvedValueOnce('<title>OK</title>');
      mockParseTitle.mockReturnValueOnce('OK');

      const { resolver, warnings } = createHarness({ cache });
      const entry = await resolver.resolve(url);

      expect(entry.title).toBe('OK');
      expect(warnings.some((w) => w.message.includes('disk on fire'))).toBe(
        true
      );
      expect(warnings.every((w) => w.url === url)).toBe(true);
    });

    it('warns and still resolves when cache.set throws', async () => {
      const url = 'https://cache-set-throws.example.com';
      const cache: Cache = {
        get: vi.fn().mockResolvedValue(undefined),
        set: vi.fn().mockRejectedValue(new Error('readonly fs')),
      };
      mockFetchHtml.mockResolvedValueOnce('<title>OK</title>');
      mockParseTitle.mockReturnValueOnce('OK');

      const { resolver, warnings } = createHarness({ cache });
      const entry = await resolver.resolve(url);

      expect(entry.title).toBe('OK');
      expect(warnings.some((w) => w.message.includes('readonly fs'))).toBe(
        true
      );
    });
  });

  describe('concurrency', () => {
    it('respects the concurrency limit across many urls', async () => {
      let inFlight = 0;
      let observedMax = 0;

      mockFetchHtml.mockImplementation(async () => {
        inFlight++;
        observedMax = Math.max(observedMax, inFlight);
        await new Promise((resolve) => setTimeout(resolve, 5));
        inFlight--;
        return '<title>X</title>';
      });
      mockParseTitle.mockReturnValue('X');

      const { resolver } = createHarness({ concurrency: 3 });
      await Promise.all(
        Array.from({ length: 10 }, (_unused, i) =>
          resolver.resolve(`https://concurrent-${i}.example.com`)
        )
      );

      expect(observedMax).toBeLessThanOrEqual(3);
      expect(mockFetchHtml).toHaveBeenCalledTimes(10);
    });

    it('does not gate cache hits behind the fetch limiter', async () => {
      mockLowdbGet.mockResolvedValue({
        title: 'Hit',
        updatedAt: '2026-01-01T00:00:00.000Z',
      });

      const { resolver } = createHarness({ concurrency: 1 });
      const entries = await Promise.all(
        Array.from({ length: 20 }, (_unused, i) =>
          resolver.resolve(`https://hit-${i}.example.com`)
        )
      );

      expect(entries.every((e) => e.title === 'Hit')).toBe(true);
      expect(mockFetchHtml).not.toHaveBeenCalled();
    });
  });
});
