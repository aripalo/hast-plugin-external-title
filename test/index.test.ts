import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import type { Element, Root } from 'hast';

// Minimal duck-typed VFile substitute. The plugin only uses `file.message(...)`
// which pushes onto `file.messages`. Avoids a hard dep on `vfile` in this repo.
interface FakeMessage {
  reason: string;
}
interface FakeVFile {
  messages: FakeMessage[];
  message: (reason: string) => FakeMessage;
}

function createFile(): FakeVFile {
  const messages: FakeMessage[] = [];
  return {
    messages,
    message(reason: string) {
      const m = { reason };
      messages.push(m);
      return m;
    },
  };
}

const mockFetchHtml = vi.fn();
const mockParseTitle = vi.fn();

vi.mock('../src/fetch-html.js', () => ({
  fetchHtml: (...args: unknown[]) => mockFetchHtml(...args),
  DEFAULT_USER_AGENT: 'Mozilla/5.0 (compatible; TitleFetcher/1.0)',
  DEFAULT_TIMEOUT: 5000,
}));

vi.mock('../src/parse-title.js', () => ({
  parseTitle: (...args: unknown[]) => mockParseTitle(...args),
}));

// Stub the lowdb cache so instantiating the plugin without options does not
// trigger any file I/O.
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

import rehypeExternalLinkTitle from '../src/index.js';
import { memoryCache } from '../src/cache/memory.js';
import { lowdbCache } from '../src/cache/lowdb.js';
import type { Cache, CacheEntry } from '../src/types.js';

function createTree(elements: Element[]): Root {
  return { type: 'root', children: elements };
}

function createLink(href: string, text = 'Link'): Element {
  return {
    type: 'element',
    tagName: 'a',
    properties: { href },
    children: [{ type: 'text', value: text }],
  };
}

function run(tree: Root, options?: Parameters<typeof rehypeExternalLinkTitle>[0]) {
  const file = createFile();
  const transformer = rehypeExternalLinkTitle(options) as (
    tree: Root,
    file: unknown
  ) => Promise<undefined>;
  return Promise.resolve(transformer(tree, file)).then(() => file);
}

describe('rehypeExternalLinkTitle', () => {
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

  describe('plugin shape', () => {
    it('returns a transformer function', () => {
      const plugin = rehypeExternalLinkTitle();
      expect(typeof plugin).toBe('function');
    });

    it('exposes named cache helpers', () => {
      expect(typeof memoryCache).toBe('function');
      expect(typeof lowdbCache).toBe('function');
    });
  });

  describe('link selection', () => {
    it('does nothing when there are no links', async () => {
      const tree = createTree([
        {
          type: 'element',
          tagName: 'p',
          properties: {},
          children: [{ type: 'text', value: 'No links here' }],
        },
      ]);

      await run(tree);

      expect(mockFetchHtml).not.toHaveBeenCalled();
      expect(mockLowdbGet).not.toHaveBeenCalled();
    });

    it('skips internal / relative / fragment links by default', async () => {
      const tree = createTree([
        createLink('/internal/page'),
        createLink('#anchor'),
        createLink('relative/path'),
      ]);

      await run(tree);

      expect(mockLowdbGet).not.toHaveBeenCalled();
    });

    it('processes https external links', async () => {
      await run(createTree([createLink('https://example.com')]));
      expect(mockLowdbGet).toHaveBeenCalledWith('https://example.com');
    });

    it('processes http external links', async () => {
      await run(createTree([createLink('http://example.com')]));
      expect(mockLowdbGet).toHaveBeenCalledWith('http://example.com');
    });

    it('skips elements without an href', async () => {
      const tree = createTree([
        { type: 'element', tagName: 'a', properties: {}, children: [] },
      ]);

      await run(tree);

      expect(mockLowdbGet).not.toHaveBeenCalled();
    });

    it('honors a custom test predicate', async () => {
      const test = vi.fn(
        (href: string) => href.startsWith('https://allowed.example.com')
      );

      const link1 = createLink('https://allowed.example.com');
      const link2 = createLink('https://denied.example.com');

      await run(createTree([link1, link2]), { test });

      expect(test).toHaveBeenCalledTimes(2);
      expect(mockLowdbGet).toHaveBeenCalledWith('https://allowed.example.com');
      expect(mockLowdbGet).not.toHaveBeenCalledWith('https://denied.example.com');
    });

    it('walks nested elements', async () => {
      const tree: Root = {
        type: 'root',
        children: [
          {
            type: 'element',
            tagName: 'div',
            properties: {},
            children: [
              {
                type: 'element',
                tagName: 'p',
                properties: {},
                children: [createLink('https://nested.example.com')],
              },
            ],
          },
        ],
      };

      await run(tree);

      expect(mockLowdbGet).toHaveBeenCalledWith('https://nested.example.com');
    });
  });

  describe('cache hits (default lowdb)', () => {
    it('uses cached title and writes data-title-updated-at when fresh', async () => {
      const url = 'https://cache-hit.example.com';
      mockLowdbGet.mockResolvedValueOnce({
        title: 'Cached Title',
        updatedAt: '2026-01-01T00:00:00.000Z',
      } satisfies CacheEntry);

      const link = createLink(url);
      await run(createTree([link]));

      expect(link.properties?.title).toBe('Cached Title');
      expect(link.properties?.['data-title-updated-at']).toBe(
        '2026-01-01T00:00:00.000Z'
      );
      expect(mockFetchHtml).not.toHaveBeenCalled();
    });

    it('writes to a custom attribute name', async () => {
      const url = 'https://custom-attr.example.com';
      mockLowdbGet.mockResolvedValueOnce({
        title: 'Y',
        updatedAt: '2026-01-01T00:00:00.000Z',
      });

      const link = createLink(url);
      await run(createTree([link]), { attribute: 'data-link-title' });

      expect(link.properties?.['data-link-title']).toBe('Y');
      expect(link.properties?.title).toBeUndefined();
    });
  });

  describe('cache miss → fetch', () => {
    it('fetches and stores when nothing is cached', async () => {
      const url = 'https://miss.example.com';
      mockLowdbGet.mockResolvedValueOnce(undefined);
      mockFetchHtml.mockResolvedValueOnce('<html><title>Fetched</title></html>');
      mockParseTitle.mockReturnValueOnce('Fetched');

      const link = createLink(url);
      await run(createTree([link]));

      expect(mockFetchHtml).toHaveBeenCalledWith(url, {});
      expect(mockParseTitle).toHaveBeenCalled();
      expect(mockLowdbSet).toHaveBeenCalledWith(
        url,
        expect.objectContaining({ title: 'Fetched' })
      );
      expect(link.properties?.title).toBe('Fetched');
    });

    it('stores a null entry on fetch failure and does not set title', async () => {
      const url = 'https://fetch-fail.example.com';
      mockLowdbGet.mockResolvedValueOnce(undefined);
      mockFetchHtml.mockRejectedValueOnce(new Error('boom'));

      const link = createLink(url);
      const file = await run(createTree([link]));

      expect(link.properties?.title).toBeUndefined();
      expect(mockLowdbSet).toHaveBeenCalledWith(
        url,
        expect.objectContaining({ title: null })
      );
      expect(file.messages.some((m) => m.reason.includes('boom'))).toBe(true);
    });

    it('stores a null entry when parser returns null', async () => {
      const url = 'https://no-title.example.com';
      mockLowdbGet.mockResolvedValueOnce(undefined);
      mockFetchHtml.mockResolvedValueOnce('<html></html>');
      mockParseTitle.mockReturnValueOnce(null);

      const link = createLink(url);
      await run(createTree([link]));

      expect(link.properties?.title).toBeUndefined();
      expect(mockLowdbSet).toHaveBeenCalledWith(
        url,
        expect.objectContaining({ title: null })
      );
    });

    it('forwards fetch options (userAgent, timeout)', async () => {
      const url = 'https://ua.example.com';
      mockLowdbGet.mockResolvedValueOnce(undefined);
      mockFetchHtml.mockResolvedValueOnce('<title>T</title>');
      mockParseTitle.mockReturnValueOnce('T');

      await run(createTree([createLink(url)]), {
        fetch: { userAgent: 'CustomBot/9.9', timeout: 1234 },
      });

      expect(mockFetchHtml).toHaveBeenCalledWith(url, {
        userAgent: 'CustomBot/9.9',
        timeout: 1234,
      });
    });
  });

  describe('cached failures (failureTtl)', () => {
    it('does not refetch when failure entry is fresh (within failureTtl)', async () => {
      const url = 'https://fresh-fail.example.com';
      mockLowdbGet.mockResolvedValueOnce({
        title: null,
        updatedAt: new Date().toISOString(),
      });

      const link = createLink(url);
      await run(createTree([link]), { failureTtl: 24 * 60 * 60 * 1000 });

      expect(mockFetchHtml).not.toHaveBeenCalled();
      expect(link.properties?.title).toBeUndefined();
    });

    it('refetches and deletes when failure entry exceeds failureTtl', async () => {
      const url = 'https://stale-fail.example.com';
      const stale = new Date(Date.now() - 25 * 60 * 60 * 1000).toISOString();
      mockLowdbGet.mockResolvedValueOnce({ title: null, updatedAt: stale });
      mockFetchHtml.mockResolvedValueOnce('<title>Now Works</title>');
      mockParseTitle.mockReturnValueOnce('Now Works');

      const link = createLink(url);
      await run(createTree([link]), { failureTtl: 24 * 60 * 60 * 1000 });

      expect(mockLowdbDelete).toHaveBeenCalledWith(url);
      expect(mockFetchHtml).toHaveBeenCalledWith(url, {});
      expect(link.properties?.title).toBe('Now Works');
    });

    it('always retries failures when failureTtl is 0', async () => {
      const url = 'https://no-fail-cache.example.com';
      mockLowdbGet.mockResolvedValueOnce({
        title: null,
        updatedAt: new Date().toISOString(),
      });
      mockFetchHtml.mockResolvedValueOnce('<title>Fresh</title>');
      mockParseTitle.mockReturnValueOnce('Fresh');

      const link = createLink(url);
      await run(createTree([link]), { failureTtl: 0 });

      expect(mockFetchHtml).toHaveBeenCalled();
      expect(link.properties?.title).toBe('Fresh');
    });
  });

  describe('successful entry TTL (ttl)', () => {
    it('does not refetch when entry is within ttl', async () => {
      const url = 'https://fresh-success.example.com';
      mockLowdbGet.mockResolvedValueOnce({
        title: 'Fresh',
        updatedAt: new Date().toISOString(),
      });

      const link = createLink(url);
      await run(createTree([link]), { ttl: 60_000 });

      expect(mockFetchHtml).not.toHaveBeenCalled();
      expect(link.properties?.title).toBe('Fresh');
    });

    it('refetches when successful entry exceeds ttl', async () => {
      const url = 'https://stale-success.example.com';
      const stale = new Date(Date.now() - 120_000).toISOString();
      mockLowdbGet.mockResolvedValueOnce({ title: 'Old', updatedAt: stale });
      mockFetchHtml.mockResolvedValueOnce('<title>New</title>');
      mockParseTitle.mockReturnValueOnce('New');

      const link = createLink(url);
      await run(createTree([link]), { ttl: 60_000 });

      expect(mockLowdbDelete).toHaveBeenCalledWith(url);
      expect(link.properties?.title).toBe('New');
    });

    it('treats Infinity (default) as never-expires', async () => {
      const url = 'https://infinite-ttl.example.com';
      const ancient = new Date('2000-01-01T00:00:00.000Z').toISOString();
      mockLowdbGet.mockResolvedValueOnce({ title: 'Ancient', updatedAt: ancient });

      const link = createLink(url);
      await run(createTree([link]));

      expect(mockFetchHtml).not.toHaveBeenCalled();
      expect(link.properties?.title).toBe('Ancient');
    });

    it('treats malformed updatedAt as expired', async () => {
      const url = 'https://bad-date.example.com';
      mockLowdbGet.mockResolvedValueOnce({ title: 'X', updatedAt: 'not-a-date' });
      mockFetchHtml.mockResolvedValueOnce('<title>Refreshed</title>');
      mockParseTitle.mockReturnValueOnce('Refreshed');

      const link = createLink(url);
      await run(createTree([link]), { ttl: 60_000 });

      expect(mockFetchHtml).toHaveBeenCalled();
      expect(link.properties?.title).toBe('Refreshed');
    });
  });

  describe('per-run dedupe', () => {
    it('queries the persistent cache only once per unique href', async () => {
      const url = 'https://duplicate.example.com';
      mockLowdbGet.mockResolvedValueOnce({
        title: 'Once',
        updatedAt: '2026-01-01T00:00:00.000Z',
      });

      const link1 = createLink(url);
      const link2 = createLink(url);
      const link3 = createLink(url);

      await run(createTree([link1, link2, link3]));

      expect(mockLowdbGet).toHaveBeenCalledTimes(1);
      expect(link1.properties?.title).toBe('Once');
      expect(link2.properties?.title).toBe('Once');
      expect(link3.properties?.title).toBe('Once');
    });
  });

  describe('cache option resolution', () => {
    it('passes string option as path to the default lowdb cache', async () => {
      vi.clearAllMocks();
      const lowdbModule = await import('../src/cache/lowdb.js');
      const lowdbSpy = vi.mocked(lowdbModule.lowdbCache);

      const link = createLink('https://path-option.example.com');
      await run(createTree([link]), { cache: '/tmp/custom.json' });

      expect(lowdbSpy).toHaveBeenCalledWith({ path: '/tmp/custom.json' });
    });

    it('uses a user-provided Cache implementation', async () => {
      const url = 'https://byo-cache.example.com';
      const userCache: Cache = {
        get: vi.fn().mockResolvedValue({
          title: 'From BYO',
          updatedAt: '2026-01-01T00:00:00.000Z',
        }),
        set: vi.fn().mockResolvedValue(undefined),
        delete: vi.fn().mockResolvedValue(undefined),
      };

      const link = createLink(url);
      await run(createTree([link]), { cache: userCache });

      expect(userCache.get).toHaveBeenCalledWith(url);
      expect(mockLowdbGet).not.toHaveBeenCalled();
      expect(link.properties?.title).toBe('From BYO');
    });

    it('treats a sync Cache.get just as well as async', async () => {
      const url = 'https://sync-cache.example.com';
      const syncCache: Cache = {
        get: () => ({ title: 'Sync', updatedAt: new Date().toISOString() }),
        set: () => {},
      };

      const link = createLink(url);
      await run(createTree([link]), { cache: syncCache });

      expect(link.properties?.title).toBe('Sync');
    });

    it('writes back to a user-provided cache on miss', async () => {
      const url = 'https://byo-write.example.com';
      const userCache: Cache = {
        get: vi.fn().mockResolvedValue(undefined),
        set: vi.fn().mockResolvedValue(undefined),
      };
      mockFetchHtml.mockResolvedValueOnce('<title>Written</title>');
      mockParseTitle.mockReturnValueOnce('Written');

      await run(createTree([createLink(url)]), { cache: userCache });

      expect(userCache.set).toHaveBeenCalledWith(
        url,
        expect.objectContaining({ title: 'Written' })
      );
    });
  });

  describe('error reporting via VFile messages', () => {
    it('records a message when cache.get throws', async () => {
      const url = 'https://cache-get-throws.example.com';
      const errorCache: Cache = {
        get: vi.fn().mockRejectedValue(new Error('disk on fire')),
        set: vi.fn().mockResolvedValue(undefined),
      };
      mockFetchHtml.mockResolvedValueOnce('<title>OK</title>');
      mockParseTitle.mockReturnValueOnce('OK');

      const link = createLink(url);
      const file = await run(createTree([link]), { cache: errorCache });

      expect(
        file.messages.some((m) => m.reason.includes('disk on fire'))
      ).toBe(true);
      expect(link.properties?.title).toBe('OK');
    });

    it('records a message when cache.set throws but still sets the attribute', async () => {
      const url = 'https://cache-set-throws.example.com';
      const errorCache: Cache = {
        get: vi.fn().mockResolvedValue(undefined),
        set: vi.fn().mockRejectedValue(new Error('readonly fs')),
      };
      mockFetchHtml.mockResolvedValueOnce('<title>OK</title>');
      mockParseTitle.mockReturnValueOnce('OK');

      const link = createLink(url);
      const file = await run(createTree([link]), { cache: errorCache });

      expect(
        file.messages.some((m) => m.reason.includes('readonly fs'))
      ).toBe(true);
      expect(link.properties?.title).toBe('OK');
    });
  });

  describe('node mutation', () => {
    it('preserves existing properties when adding the title', async () => {
      const url = 'https://preserve-props.example.com';
      mockLowdbGet.mockResolvedValueOnce({
        title: 'P',
        updatedAt: '2026-01-01T00:00:00.000Z',
      });

      const link: Element = {
        type: 'element',
        tagName: 'a',
        properties: { href: url, className: ['external-link'], target: '_blank' },
        children: [],
      };

      await run(createTree([link]));

      expect(link.properties?.className).toEqual(['external-link']);
      expect(link.properties?.target).toBe('_blank');
      expect(link.properties?.title).toBe('P');
    });

    it('initializes properties when the node is missing them', async () => {
      const url = 'https://no-props.example.com';
      mockLowdbGet.mockResolvedValueOnce({
        title: 'X',
        updatedAt: '2026-01-01T00:00:00.000Z',
      });

      const link: Element = {
        type: 'element',
        tagName: 'a',
        properties: { href: url },
        children: [],
      };

      await run(createTree([link]));

      expect(link.properties).toBeDefined();
      expect(link.properties?.title).toBe('X');
    });
  });

  describe('includeUpdatedAt option', () => {
    it('writes data-title-updated-at by default (cache hit)', async () => {
      const url = 'https://ts-default-hit.example.com';
      mockLowdbGet.mockResolvedValueOnce({
        title: 'T',
        updatedAt: '2026-01-01T00:00:00.000Z',
      });

      const link = createLink(url);
      await run(createTree([link]));

      expect(link.properties?.['data-title-updated-at']).toBe(
        '2026-01-01T00:00:00.000Z'
      );
    });

    it('writes data-title-updated-at by default (fresh fetch)', async () => {
      const url = 'https://ts-default-fetch.example.com';
      mockLowdbGet.mockResolvedValueOnce(undefined);
      mockFetchHtml.mockResolvedValueOnce('<title>Fresh</title>');
      mockParseTitle.mockReturnValueOnce('Fresh');

      const link = createLink(url);
      await run(createTree([link]));

      expect(link.properties?.title).toBe('Fresh');
      expect(typeof link.properties?.['data-title-updated-at']).toBe('string');
      // The freshly written timestamp should parse as a valid ISO date.
      expect(
        Number.isNaN(
          Date.parse(String(link.properties?.['data-title-updated-at']))
        )
      ).toBe(false);
    });

    it('writes data-title-updated-at when includeUpdatedAt is explicitly true', async () => {
      const url = 'https://ts-true.example.com';
      mockLowdbGet.mockResolvedValueOnce({
        title: 'T',
        updatedAt: '2026-01-01T00:00:00.000Z',
      });

      const link = createLink(url);
      await run(createTree([link]), { includeUpdatedAt: true });

      expect(link.properties?.['data-title-updated-at']).toBe(
        '2026-01-01T00:00:00.000Z'
      );
    });

    it('omits data-title-updated-at when includeUpdatedAt is false (cache hit)', async () => {
      const url = 'https://ts-false-hit.example.com';
      mockLowdbGet.mockResolvedValueOnce({
        title: 'T',
        updatedAt: '2026-01-01T00:00:00.000Z',
      });

      const link = createLink(url);
      await run(createTree([link]), { includeUpdatedAt: false });

      expect(link.properties?.title).toBe('T');
      expect(link.properties?.['data-title-updated-at']).toBeUndefined();
    });

    it('omits data-title-updated-at when includeUpdatedAt is false (fresh fetch)', async () => {
      const url = 'https://ts-false-fetch.example.com';
      mockLowdbGet.mockResolvedValueOnce(undefined);
      mockFetchHtml.mockResolvedValueOnce('<title>Fresh</title>');
      mockParseTitle.mockReturnValueOnce('Fresh');

      const link = createLink(url);
      await run(createTree([link]), { includeUpdatedAt: false });

      expect(link.properties?.title).toBe('Fresh');
      expect(link.properties?.['data-title-updated-at']).toBeUndefined();
    });

    it('does not strip a pre-existing data-title-updated-at when includeUpdatedAt is false', async () => {
      const url = 'https://ts-preserve.example.com';
      mockLowdbGet.mockResolvedValueOnce({
        title: 'T',
        updatedAt: '2026-01-01T00:00:00.000Z',
      });

      const link: Element = {
        type: 'element',
        tagName: 'a',
        properties: { href: url, 'data-title-updated-at': 'preset-value' },
        children: [],
      };

      await run(createTree([link]), { includeUpdatedAt: false });

      expect(link.properties?.title).toBe('T');
      // Author-supplied attribute is left untouched; the plugin doesn't delete it.
      expect(link.properties?.['data-title-updated-at']).toBe('preset-value');
    });

    it('does not write data-title-updated-at when title is null even if includeUpdatedAt is true', async () => {
      const url = 'https://ts-null-title.example.com';
      mockLowdbGet.mockResolvedValueOnce({
        title: null,
        updatedAt: new Date().toISOString(),
      });

      const link = createLink(url);
      await run(createTree([link]), { includeUpdatedAt: true });

      expect(link.properties?.title).toBeUndefined();
      expect(link.properties?.['data-title-updated-at']).toBeUndefined();
    });
  });

  describe('concurrency', () => {
    it('respects the concurrency limit', async () => {
      const links = Array.from({ length: 10 }, (_, i) =>
        createLink(`https://concurrent-${i}.example.com`)
      );

      let inFlight = 0;
      let observedMax = 0;

      mockLowdbGet.mockResolvedValue(undefined);
      mockFetchHtml.mockImplementation(async () => {
        inFlight++;
        observedMax = Math.max(observedMax, inFlight);
        await new Promise((resolve) => setTimeout(resolve, 5));
        inFlight--;
        return '<title>X</title>';
      });
      mockParseTitle.mockReturnValue('X');

      await run(createTree(links), { concurrency: 3 });

      expect(observedMax).toBeLessThanOrEqual(3);
      expect(mockFetchHtml).toHaveBeenCalledTimes(10);
    });
  });
});
