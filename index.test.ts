import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import type { Root, Element } from 'hast';

// Mock dependencies
const mockGetTitle = vi.fn();
const mockSetTitle = vi.fn();
const mockFetchHtml = vi.fn();
const mockParseTitle = vi.fn();

vi.mock('./database', () => ({
  getTitle: (...args: unknown[]) => mockGetTitle(...args),
  setTitle: (...args: unknown[]) => mockSetTitle(...args),
}));

vi.mock('./fetch-html', () => ({
  fetchHtml: (...args: unknown[]) => mockFetchHtml(...args),
}));

vi.mock('./parse-title', () => ({
  parseTitle: (...args: unknown[]) => mockParseTitle(...args),
}));

import { rehypeExtlink } from './index';

function createTree(elements: Element[]): Root {
  return {
    type: 'root',
    children: elements,
  };
}

function createLink(href: string, text: string = 'Link'): Element {
  return {
    type: 'element',
    tagName: 'a',
    properties: { href },
    children: [{ type: 'text', value: text }],
  };
}

describe('rehypeExtlink', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockGetTitle.mockResolvedValue({ exists: false, entry: null });
    mockSetTitle.mockResolvedValue(undefined);
    mockFetchHtml.mockResolvedValue('<html><title>Test Title</title></html>');
    mockParseTitle.mockReturnValue('Test Title');
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  it('should return a function', () => {
    const plugin = rehypeExtlink();
    expect(typeof plugin).toBe('function');
  });

  it('should process tree without external links', async () => {
    const tree = createTree([
      {
        type: 'element',
        tagName: 'p',
        properties: {},
        children: [{ type: 'text', value: 'No links here' }],
      },
    ]);

    const plugin = rehypeExtlink();
    await plugin(tree);

    expect(mockGetTitle).not.toHaveBeenCalled();
    expect(mockFetchHtml).not.toHaveBeenCalled();
  });

  it('should skip internal links (no protocol)', async () => {
    const tree = createTree([
      createLink('/internal/page'),
      createLink('#anchor'),
      createLink('relative/path'),
    ]);

    const plugin = rehypeExtlink();
    await plugin(tree);

    expect(mockGetTitle).not.toHaveBeenCalled();
  });

  it('should process https external links', async () => {
    const link = createLink('https://example.com');
    const tree = createTree([link]);

    const plugin = rehypeExtlink();
    await plugin(tree);

    expect(mockGetTitle).toHaveBeenCalledWith('https://example.com');
  });

  it('should process http external links', async () => {
    const link = createLink('http://example.com');
    const tree = createTree([link]);

    const plugin = rehypeExtlink();
    await plugin(tree);

    expect(mockGetTitle).toHaveBeenCalledWith('http://example.com');
  });

  it('should use database cache when available', async () => {
    const uniqueUrl = 'https://db-cache-test.example.com';
    mockGetTitle.mockResolvedValue({
      exists: true,
      entry: { title: 'Cached Title', updatedAt: '2024-01-01T00:00:00.000Z' },
    });

    const link = createLink(uniqueUrl);
    const tree = createTree([link]);

    const plugin = rehypeExtlink();
    await plugin(tree);

    expect(link.properties?.title).toBe('Cached Title');
    expect(link.properties?.['data-title-updated-at']).toBe('2024-01-01T00:00:00.000Z');
    expect(mockFetchHtml).not.toHaveBeenCalled();
  });

  it('should fetch title when not in database', async () => {
    const uniqueUrl = 'https://fetch-title-test.example.com';
    mockGetTitle.mockResolvedValue({ exists: false, entry: null });
    mockFetchHtml.mockResolvedValue('<html><title>Fetched Title</title></html>');
    mockParseTitle.mockReturnValue('Fetched Title');

    const link = createLink(uniqueUrl);
    const tree = createTree([link]);

    const plugin = rehypeExtlink();
    await plugin(tree);

    expect(mockFetchHtml).toHaveBeenCalledWith(uniqueUrl);
    expect(mockParseTitle).toHaveBeenCalled();
    expect(mockSetTitle).toHaveBeenCalledWith(uniqueUrl, 'Fetched Title');
    expect(link.properties?.title).toBe('Fetched Title');
  });

  it('should not set title when entry exists but is an error entry', async () => {
    const uniqueUrl = 'https://error-entry-test.example.com';
    mockGetTitle.mockResolvedValue({
      exists: true,
      entry: { error: 'Failed to fetch title', updatedAt: '2024-01-01T00:00:00.000Z' },
    });

    const link = createLink(uniqueUrl);
    const tree = createTree([link]);

    const plugin = rehypeExtlink();
    await plugin(tree);

    expect(link.properties?.title).toBeUndefined();
    expect(mockFetchHtml).not.toHaveBeenCalled();
  });

  it('should not set title when entry has null title', async () => {
    const uniqueUrl = 'https://null-title-test.example.com';
    mockGetTitle.mockResolvedValue({
      exists: true,
      entry: { title: null, updatedAt: '2024-01-01T00:00:00.000Z' },
    });

    const link = createLink(uniqueUrl);
    const tree = createTree([link]);

    const plugin = rehypeExtlink();
    await plugin(tree);

    expect(link.properties?.title).toBeUndefined();
    expect(mockFetchHtml).not.toHaveBeenCalled();
  });

  it('should handle fetch failure gracefully', async () => {
    const uniqueUrl = 'https://fetch-failure-test.example.com';
    mockGetTitle.mockResolvedValue({ exists: false, entry: null });
    // When fetchHtml fails, fetchPageTitle catches and returns null
    mockFetchHtml.mockRejectedValue(new Error('Network error'));

    const link = createLink(uniqueUrl);
    const tree = createTree([link]);

    const plugin = rehypeExtlink();
    await plugin(tree);

    // Title should not be set when fetch fails
    expect(link.properties?.title).toBeUndefined();
    // setTitle should be called with null
    expect(mockSetTitle).toHaveBeenCalledWith(uniqueUrl, null);
  });

  it('should log warning when database operation throws', async () => {
    const uniqueUrl = 'https://db-error-test.example.com';
    mockGetTitle.mockRejectedValue(new Error('Database error'));

    const link = createLink(uniqueUrl);
    const tree = createTree([link]);

    const consoleWarnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});

    const plugin = rehypeExtlink();
    await plugin(tree);

    expect(consoleWarnSpy).toHaveBeenCalled();
    expect(link.properties?.title).toBeUndefined();

    consoleWarnSpy.mockRestore();
  });

  it('should store null in database when parse returns null', async () => {
    const uniqueUrl = 'https://null-parse-test.example.com';
    mockGetTitle.mockResolvedValue({ exists: false, entry: null });
    mockFetchHtml.mockResolvedValue('<html><head></head></html>');
    mockParseTitle.mockReturnValue(null);

    const link = createLink(uniqueUrl);
    const tree = createTree([link]);

    const plugin = rehypeExtlink();
    await plugin(tree);

    expect(mockSetTitle).toHaveBeenCalledWith(uniqueUrl, null);
    expect(link.properties?.title).toBeUndefined();
  });

  it('should process multiple links in parallel', async () => {
    mockGetTitle.mockResolvedValue({ exists: false, entry: null });
    mockParseTitle.mockReturnValue('Title');

    const link1 = createLink('https://example1.com');
    const link2 = createLink('https://example2.com');
    const link3 = createLink('https://example3.com');
    const tree = createTree([link1, link2, link3]);

    const plugin = rehypeExtlink();
    await plugin(tree);

    expect(mockGetTitle).toHaveBeenCalledTimes(3);
    expect(mockFetchHtml).toHaveBeenCalledTimes(3);
  });

  it('should use in-memory cache for duplicate URLs in same run', async () => {
    // Use a unique URL to avoid cache from other tests
    const uniqueUrl = 'https://unique-cache-test.example.com';
    
    mockGetTitle.mockResolvedValue({ exists: false, entry: null });
    mockParseTitle.mockReturnValue('Cached Title');

    // Two links with the same URL in the same tree
    const link1 = createLink(uniqueUrl);
    const link2 = createLink(uniqueUrl);
    const tree = createTree([link1, link2]);

    const plugin = rehypeExtlink();
    await plugin(tree);

    // Both links should have the title set
    expect(link1.properties?.title).toBe('Cached Title');
    expect(link2.properties?.title).toBe('Cached Title');
    
    // Database should only be queried once for the same URL
    expect(mockGetTitle).toHaveBeenCalledTimes(2); // Called for both, but cache kicks in during processing
  });

  it('should return early from in-memory cache on subsequent calls', async () => {
    // This URL will be cached after the first call
    const cachedUrl = 'https://memory-cache-hit-test.example.com';
    
    // First call: cache miss, fetch from network
    mockGetTitle.mockResolvedValue({ exists: false, entry: null });
    mockParseTitle.mockReturnValue('Memory Cached Title');
    
    const link1 = createLink(cachedUrl);
    const tree1 = createTree([link1]);
    
    const plugin = rehypeExtlink();
    await plugin(tree1);
    
    expect(link1.properties?.title).toBe('Memory Cached Title');
    
    // Clear mocks
    vi.clearAllMocks();
    mockGetTitle.mockResolvedValue({ exists: false, entry: null });
    
    // Second call with same URL: should hit in-memory cache
    const link2 = createLink(cachedUrl);
    const tree2 = createTree([link2]);
    
    await plugin(tree2);
    
    // Link should have title from cache
    expect(link2.properties?.title).toBe('Memory Cached Title');
    // Database should NOT have been called because of in-memory cache
    expect(mockGetTitle).not.toHaveBeenCalled();
    expect(mockFetchHtml).not.toHaveBeenCalled();
  });

  it('should initialize properties if not present', async () => {
    // Use unique URL to avoid cache interference
    const uniqueUrl = 'https://init-props-test.example.com';
    
    mockGetTitle.mockResolvedValue({
      exists: true,
      entry: { title: 'Init Props Title', updatedAt: '2024-01-01T00:00:00.000Z' },
    });

    const link: Element = {
      type: 'element',
      tagName: 'a',
      properties: { href: uniqueUrl },
      children: [],
    };
    const tree = createTree([link]);

    const plugin = rehypeExtlink();
    await plugin(tree);

    expect(link.properties).toBeDefined();
    expect(link.properties?.title).toBe('Init Props Title');
  });

  it('should not process elements without href', async () => {
    const link: Element = {
      type: 'element',
      tagName: 'a',
      properties: {},
      children: [],
    };
    const tree = createTree([link]);

    const plugin = rehypeExtlink();
    await plugin(tree);

    expect(mockGetTitle).not.toHaveBeenCalled();
  });

  it('should preserve existing properties when adding title from database', async () => {
    const uniqueUrl = 'https://preserve-props-db.example.com';
    mockGetTitle.mockResolvedValue({
      exists: true,
      entry: { title: 'DB Title', updatedAt: '2024-01-01T00:00:00.000Z' },
    });

    const link: Element = {
      type: 'element',
      tagName: 'a',
      properties: { href: uniqueUrl, class: 'external-link', target: '_blank' },
      children: [],
    };
    const tree = createTree([link]);

    const plugin = rehypeExtlink();
    await plugin(tree);

    // Original properties should be preserved
    expect(link.properties?.class).toBe('external-link');
    expect(link.properties?.target).toBe('_blank');
    // Title should be added
    expect(link.properties?.title).toBe('DB Title');
  });

  it('should preserve existing properties when adding title from fetch', async () => {
    const uniqueUrl = 'https://preserve-props-fetch.example.com';
    mockGetTitle.mockResolvedValue({ exists: false, entry: null });
    mockParseTitle.mockReturnValue('Fetched Title');

    const link: Element = {
      type: 'element',
      tagName: 'a',
      properties: { href: uniqueUrl, class: 'external-link' },
      children: [],
    };
    const tree = createTree([link]);

    const plugin = rehypeExtlink();
    await plugin(tree);

    // Original properties should be preserved
    expect(link.properties?.class).toBe('external-link');
    // Title should be added
    expect(link.properties?.title).toBe('Fetched Title');
  });

  it('should handle nested links', async () => {
    mockGetTitle.mockResolvedValue({ exists: false, entry: null });
    mockParseTitle.mockReturnValue('Nested Title');

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

    const plugin = rehypeExtlink();
    await plugin(tree);

    expect(mockGetTitle).toHaveBeenCalledWith('https://nested.example.com');
  });
});

