import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { markdownToHtml } from 'satteri';

import externalTitle, { PLUGIN_NAME } from '../src/index.js';
import { memoryCache } from '../src/cache/memory.js';
import type { Options } from '../src/types.js';

const realFetch = globalThis.fetch;

/** Records every URL passed to the stubbed `fetch`. */
let requested: string[] = [];

interface StubResult {
  status?: number;
  body?: string;
  contentType?: string | null;
}

/**
 * Installs a `fetch` stub built on real `Response` objects, so the code under
 * test gets genuine headers and a genuine body stream.
 */
function stubFetch(handler: (url: string) => StubResult | Error): void {
  globalThis.fetch = vi.fn(async (input: unknown) => {
    const url = String(input);
    requested.push(url);
    const result = handler(url);
    if (result instanceof Error) throw result;

    const contentType =
      result.contentType === undefined
        ? 'text/html; charset=utf-8'
        : result.contentType;

    return new Response(result.body ?? '', {
      status: result.status ?? 200,
      headers: contentType === null ? {} : { 'content-type': contentType },
    });
  }) as unknown as typeof fetch;
}

/** Compiles `source` with the plugin, using an isolated in-memory cache. */
function compile(source: string, options: Options = {}) {
  return markdownToHtml(source, {
    hastPlugins: [
      externalTitle({
        cache: memoryCache(),
        onWarning: () => {},
        ...options,
      }),
    ],
  });
}

beforeEach(() => {
  requested = [];
  stubFetch((url) => ({
    body: `<html><head><title>Title of ${new URL(url).host}</title></head><body>ignored</body></html>`,
  }));
});

afterEach(() => {
  globalThis.fetch = realFetch;
  vi.restoreAllMocks();
});

describe('hastPluginExternalTitle', () => {
  it('is registered under the package name', () => {
    expect(externalTitle().name).toBe(PLUGIN_NAME);
    expect(PLUGIN_NAME).toBe('hast-plugin-external-title');
  });

  it('only subscribes to anchor elements', () => {
    const plugin = externalTitle();
    expect(plugin.element.filter).toEqual(['a']);
  });

  it('sets title and data-title-updated-at on an external link', async () => {
    const { html } = await compile('[x](https://example.com/page)');

    expect(html).toContain('title="Title of example.com"');
    expect(html).toMatch(/data-title-updated-at="\d{4}-\d{2}-\d{2}T[^"]+"/);
    expect(requested).toEqual(['https://example.com/page']);
  });

  it('leaves relative, fragment and mailto links untouched', async () => {
    const { html } = await compile(
      '[a](/internal) [b](#anchor) [c](relative/path) [d](mailto:x@example.com)'
    );

    expect(html).not.toContain('title=');
    expect(html).not.toContain('data-title-updated-at');
    expect(requested).toEqual([]);
  });

  it('handles http as well as https', async () => {
    const { html } = await compile('[x](http://insecure.example.com)');

    expect(html).toContain('title="Title of insecure.example.com"');
  });

  it('writes to a custom attribute name', async () => {
    const { html } = await compile('[x](https://example.com)', {
      attribute: 'data-link-title',
    });

    expect(html).toContain('data-link-title="Title of example.com"');
    expect(html).not.toMatch(/\stitle="/);
  });

  it('omits data-title-updated-at when includeUpdatedAt is false', async () => {
    const { html } = await compile('[x](https://example.com)', {
      includeUpdatedAt: false,
    });

    expect(html).toContain('title="Title of example.com"');
    expect(html).not.toContain('data-title-updated-at');
  });

  it('leaves the anchor unchanged when the fetch fails', async () => {
    stubFetch(() => new Error('network down'));

    const warnings: string[] = [];
    const { html } = await compile('[x](https://broken.example.com)', {
      onWarning: (warning) => warnings.push(warning.message),
    });

    expect(html).toBe('<p><a href="https://broken.example.com">x</a></p>\n');
    expect(warnings.some((m) => m.includes('network down'))).toBe(true);
  });

  it('leaves the anchor unchanged on a non-ok response', async () => {
    stubFetch(() => ({ status: 404, body: 'nope' }));

    const { html } = await compile('[x](https://missing.example.com)');

    expect(html).not.toContain('title=');
  });

  it('leaves the anchor unchanged when the page has no title', async () => {
    stubFetch(() => ({ body: '<html><head></head><body>no title</body></html>' }));

    const { html } = await compile('[x](https://untitled.example.com)');

    expect(html).not.toContain('title=');
  });

  it('leaves the anchor unchanged for a non-HTML content-type', async () => {
    stubFetch(() => ({
      contentType: 'application/pdf',
      body: '%PDF-1.7 not html',
    }));

    const warnings: string[] = [];
    const { html } = await compile('[x](https://doc.example.com/paper.pdf)', {
      onWarning: (warning) => warnings.push(warning.message),
    });

    expect(html).not.toContain('title=');
    expect(warnings.some((m) => m.includes('unsupported content-type'))).toBe(
      true
    );
  });

  it('leaves the anchor unchanged when the response has no content-type', async () => {
    stubFetch(() => ({ contentType: null, body: '<title>Hidden</title>' }));

    const { html } = await compile('[x](https://headerless.example.com)');

    expect(html).not.toContain('title=');
  });

  it('fetches once for a url repeated within a document', async () => {
    const { html } = await compile(
      '[one](https://dupe.example.com) and [two](https://dupe.example.com)'
    );

    expect(requested).toEqual(['https://dupe.example.com']);
    expect(html.match(/title="Title of dupe\.example\.com"/g)).toHaveLength(2);
  });

  it('shares resolved titles across documents for one plugin instance', async () => {
    const plugin = externalTitle({
      cache: memoryCache(),
      onWarning: () => {},
    });

    const first = await markdownToHtml('[a](https://shared.example.com)', {
      hastPlugins: [plugin],
    });
    const second = await markdownToHtml('[b](https://shared.example.com)', {
      hastPlugins: [plugin],
    });

    expect(requested).toEqual(['https://shared.example.com']);
    expect(first.html).toContain('title="Title of shared.example.com"');
    expect(second.html).toContain('title="Title of shared.example.com"');
  });

  it('honors a custom test predicate and passes it the anchor node', async () => {
    const tagNames: string[] = [];
    const test = vi.fn((href: string, node) => {
      tagNames.push(node.tagName);
      return href.startsWith('https://allowed.example.com');
    });

    const { html } = await compile(
      '[a](https://allowed.example.com) [b](https://denied.example.com)',
      { test }
    );

    expect(test).toHaveBeenCalledTimes(2);
    expect(tagNames).toEqual(['a', 'a']);
    expect(requested).toEqual(['https://allowed.example.com']);
    expect(html).toContain('title="Title of allowed.example.com"');
    expect(html).not.toContain('title="Title of denied.example.com"');
  });

  it('forwards fetch options to the request', async () => {
    await compile('[x](https://ua.example.com)', {
      fetch: { userAgent: 'CustomBot/9.9' },
    });

    expect(globalThis.fetch).toHaveBeenCalledWith(
      'https://ua.example.com',
      expect.objectContaining({
        headers: { 'User-Agent': 'CustomBot/9.9' },
      })
    );
  });

  it('preserves author-supplied attributes on a raw HTML anchor', async () => {
    const { html } = await markdownToHtml(
      '<a href="https://raw.example.com" class="ext" target="_blank">x</a>',
      {
        features: { rawHtml: true },
        hastPlugins: [
          externalTitle({ cache: memoryCache(), onWarning: () => {} }),
        ],
      }
    );

    expect(html).toContain('class="ext"');
    expect(html).toContain('target="_blank"');
    expect(html).toContain('title="Title of raw.example.com"');
  });

  it('skips raw HTML anchors unless the rawHtml feature is enabled', async () => {
    const source = '<a href="https://raw-default.example.com">x</a>';

    const withoutFeature = await compile(source);
    expect(withoutFeature.html).not.toContain('title=');
    expect(requested).toEqual([]);

    const withFeature = await markdownToHtml(source, {
      features: { rawHtml: true },
      hastPlugins: [
        externalTitle({ cache: memoryCache(), onWarning: () => {} }),
      ],
    });
    expect(withFeature.html).toContain('title="Title of raw-default.example.com"');
  });

  it('reads the title through the real sanitize + parse pipeline', async () => {
    stubFetch(() => ({
      body: [
        '<html><head>',
        '<script>document.title = "injected"</script>',
        '<title>  Real &amp; Trimmed  </title>',
        '</head><body><title>Body Title</title></body></html>',
      ].join(''),
    }));

    const { html } = await compile('[x](https://sanitized.example.com)');

    expect(html).toContain('title="Real &amp; Trimmed"');
  });

  it('respects the concurrency limit across a document', async () => {
    let inFlight = 0;
    let observedMax = 0;

    globalThis.fetch = vi.fn(async (input: unknown) => {
      inFlight++;
      observedMax = Math.max(observedMax, inFlight);
      await new Promise((resolve) => setTimeout(resolve, 5));
      inFlight--;
      return new Response(
        `<html><head><title>${new URL(String(input)).host}</title></head></html>`,
        { headers: { 'content-type': 'text/html' } }
      );
    }) as unknown as typeof fetch;

    const links = Array.from(
      { length: 10 },
      (_unused, i) => `[l${i}](https://host-${i}.example.com)`
    ).join(' ');

    await compile(links, { concurrency: 3 });

    expect(observedMax).toBeLessThanOrEqual(3);
    expect(globalThis.fetch).toHaveBeenCalledTimes(10);
  });
});
