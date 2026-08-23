import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { existsSync, readFileSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

import * as cheerio from 'cheerio';
import { build } from 'astro';
import { satteri } from '@astrojs/markdown-satteri';
import { http, HttpResponse } from 'msw';
import { setupServer } from 'msw/node';

import externalTitle from '../../src/index.js';
import { memoryCache } from '../../src/cache/index.js';
import { DEFAULT_USER_AGENT } from '../../src/fetch-html.js';
import type { Warning } from '../../src/types.js';

/**
 * One real Astro v7 build, end to end.
 *
 * The rest of the suite drives `markdownToHtml` from Sätteri directly, which
 * proves the plugin against Sätteri but never against Astro's wiring: that
 * `markdown.processor: satteri({hastPlugins})` actually reaches the plugin, and
 * that a `.md` page under `src/pages/` routes through that processor at all.
 *
 * The network is mocked with MSW instead of reaching example.com. That works
 * because Astro's build runs entirely in the calling process — the markdown
 * processor is invoked from the `astro:markdown` Vite plugin's `load` hook — so
 * the `globalThis.fetch` MSW patches is the one the plugin calls. That is an
 * assumption about someone else's internals, so the first block of assertions
 * proves it rather than trusting it.
 */

/** The URL the fixture page links to. */
const EXTERNAL_URL = 'https://example.com';

/**
 * The title MSW serves.
 *
 * Deliberately *not* the real example.com title. If interception ever broke and
 * the build reached the internet, the emitted title would be `Example Domain`
 * and this test would fail rather than silently pass.
 */
const MOCK_TITLE = 'Example Domain (from MSW)';

const MOCK_PAGE = [
  '<!doctype html><html><head>',
  `<title>${MOCK_TITLE}</title>`,
  '</head><body>body text the plugin must never read</body></html>',
].join('');

/** Requests a handler answered — proof the mock, not the network, replied. */
const mocked: { url: string; userAgent: string | null }[] = [];

/** Requests MSW passed through to the real network. Must stay empty. */
const bypassed: string[] = [];

/** Requests no handler matched. Must stay empty. */
const unhandled: string[] = [];

/** Non-fatal problems the plugin reported. Must stay empty. */
const warnings: Warning[] = [];

const server = setupServer(
  // `HttpResponse.html` sets `content-type: text/html` exactly, which the
  // plugin's strict gate requires. `new HttpResponse(string)` would send
  // `text/plain;charset=UTF-8` and be rejected before a byte was read.
  http.get(EXTERNAL_URL, ({ request }) => {
    mocked.push({
      url: request.url,
      // Identifies the caller as this plugin rather than something inside
      // Astro or Vite that happens to hit the same origin.
      userAgent: request.headers.get('user-agent'),
    });
    return HttpResponse.html(MOCK_PAGE);
  })
);

const repoRoot = fileURLToPath(new URL('../../', import.meta.url));
const fixtureRoot = join(repoRoot, 'test', 'fixtures', 'astro');

// Both live inside the fixture, and both must sit under `process.cwd()`:
// Astro's `getOutDirWithinCwd` silently redirects the intermediate server build
// to `<cwd>/.astro/` when `outDir` escapes cwd, which puts build droppings in
// the repo root instead of where cleanup looks.
const outDir = join(fixtureRoot, '.output');
const cacheDir = join(fixtureRoot, '.cache');

let previousTelemetryFlag: string | undefined;
let html: string;

beforeAll(async () => {
  // `build()` records telemetry unconditionally, which both writes a config
  // file under the user's home directory and POSTs to telemetry.astro.build —
  // the latter would trip the unhandled-request guard below with a baffling
  // error.
  previousTelemetryFlag = process.env.ASTRO_TELEMETRY_DISABLED;
  process.env.ASTRO_TELEMETRY_DISABLED = '1';

  // Asserted, not assumed: see the comment on `outDir`.
  expect(outDir.startsWith(process.cwd())).toBe(true);

  server.events.on('response:bypass', ({ request }) => {
    bypassed.push(request.url);
  });

  server.listen({
    // The callback form rather than `'error'`. MSW skips the string strategies
    // for "common asset" requests — anything ending .html/.js/.json, `file:`
    // URLs, paths containing node_modules — and lets those reach the real
    // network. The callback branch returns before that check, so it sees
    // everything. Recording the URL before erroring turns a stray request into
    // a readable assertion instead of a throw from deep inside the build.
    onUnhandledRequest(request, print) {
      unhandled.push(request.url);
      print.error();
    },
  });

  await build({
    root: fixtureRoot,
    outDir,
    cacheDir,
    // The fixture has no astro.config.mjs, and `false` also stops Astro
    // searching upwards and finding something else.
    configFile: false,
    logLevel: 'silent',
    markdown: {
      // Exactly the shape the Astro docs prescribe for markdown processor
      // plugins. `satteri()` keeps this array by reference and Astro's config
      // schema preserves that reference, so the instance built here is the
      // instance that runs.
      processor: satteri({
        hastPlugins: [
          externalTitle({
            // Never the default lowdb cache: that writes ./db.titles.json
            // relative to cwd, straight into the repo.
            cache: memoryCache(),
            onWarning: (warning) => warnings.push(warning),
          }),
        ],
      }),
    },
  });

  // `build.format: 'directory'` (the default) puts the root route here.
  html = readFileSync(join(outDir, 'index.html'), 'utf8');
}, 120_000);

afterAll(() => {
  server.close();
  server.events.removeAllListeners();

  if (previousTelemetryFlag === undefined) {
    delete process.env.ASTRO_TELEMETRY_DISABLED;
  } else {
    process.env.ASTRO_TELEMETRY_DISABLED = previousTelemetryFlag;
  }

  for (const leftover of [
    outDir,
    cacheDir,
    // Written by `sync`, which `build()` always runs with no way to skip.
    join(fixtureRoot, '.astro'),
    // Vite's own cache dir, which Astro derives from the project root rather
    // than from `cacheDir` above.
    join(fixtureRoot, 'node_modules'),
  ]) {
    rmSync(leftover, { recursive: true, force: true });
  }
});

describe('Astro v7 build with the plugin registered via markdown.processor', () => {
  describe('the mock answered, not the network', () => {
    // First on purpose: if interception failed, these say so, instead of
    // leaving the title assertions to fail for an opaque reason.

    it('answered exactly one request, from a handler', () => {
      expect(mocked.map((entry) => entry.url)).toEqual([`${EXTERNAL_URL}/`]);
    });

    it('answered a request made by this plugin', () => {
      expect(mocked[0]?.userAgent).toBe(DEFAULT_USER_AGENT);
    });

    it('passed nothing through to the real network', () => {
      expect(bypassed).toEqual([]);
    });

    it('left no request unhandled', () => {
      expect(unhandled).toEqual([]);
    });
  });

  it('rendered the page through Astro', () => {
    // Astro prepends this to a layout-less Markdown page, so its presence
    // proves the assertions below read Astro's output rather than something
    // Sätteri produced on its own.
    expect(html).toContain('<meta charset="utf-8">');
  });

  it('writes the fetched title onto the external link', () => {
    const anchor = cheerio.load(html)(`a[href="${EXTERNAL_URL}"]`);

    expect(anchor).toHaveLength(1);
    expect(anchor.attr('title')).toBe(MOCK_TITLE);
  });

  it('writes the cache timestamp as a parseable date', () => {
    const updatedAt = cheerio
      .load(html)(`a[href="${EXTERNAL_URL}"]`)
      .attr('data-title-updated-at');

    expect(updatedAt).toBeDefined();
    expect(Number.isNaN(Date.parse(updatedAt!))).toBe(false);
  });

  it('leaves the relative link untouched', () => {
    const anchor = cheerio.load(html)('a[href="/somewhere-else"]');

    expect(anchor).toHaveLength(1);
    expect(anchor.attr('title')).toBeUndefined();
    expect(anchor.attr('data-title-updated-at')).toBeUndefined();
  });

  it('does not leak the fetched page body into the document', () => {
    expect(html).not.toContain('body text the plugin must never read');
  });

  it('reports no warnings', () => {
    expect(warnings).toEqual([]);
  });

  it('leaves nothing behind outside the fixture', () => {
    // Absence proves the `cache` option above is still doing its job.
    expect(existsSync(join(repoRoot, 'db.titles.json'))).toBe(false);
    // Where Astro redirects the intermediate build if `outDir` escapes cwd.
    expect(existsSync(join(repoRoot, '.astro'))).toBe(false);
  });
});
