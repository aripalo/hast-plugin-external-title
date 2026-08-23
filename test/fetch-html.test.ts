import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import http from 'node:http';
import type { AddressInfo } from 'node:net';

import {
  fetchHtml,
  DEFAULT_USER_AGENT,
  DEFAULT_MAX_BYTES,
} from '../src/fetch-html.js';
import { parseTitle } from '../src/parse-title.js';

/**
 * These tests drive a real HTTP server rather than a `fetch` stub. Streaming,
 * charset decoding and abort behavior are the things most worth covering here,
 * and a hand-rolled `Response` fake cannot exercise any of them — a faked one
 * is also what let the original "stalled body ignores the timeout" bug hide.
 *
 * Real timers throughout: `AbortSignal.timeout` and stream reads both need
 * them.
 */

/** Requests the server saw, for asserting on headers. */
let received: http.IncomingMessage[] = [];

/** A head fat enough that stopping early is measurable. */
const FAT_HEAD = Array.from(
  { length: 60 },
  (_unused, i) => `<meta name="k${i}" content="${'v'.repeat(200)}">`
).join('\n');

/** ~2 MB document whose `<title>` sits in the middle of the head. */
function bigPage(title: string): string {
  return (
    `<!doctype html><html><head>\n${FAT_HEAD}\n<title>${title}</title>\n` +
    `${FAT_HEAD}\n</head><body>${'B'.repeat(2_000_000)}</body></html>`
  );
}

let server: http.Server;
let base: string;

beforeAll(async () => {
  server = http.createServer((req, res) => {
    received.push(req);
    const url = req.url ?? '/';

    switch (url) {
      case '/':
        res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
        res.end('<html><head><title>Simple Title</title></head><body>x</body></html>');
        return;

      case '/big':
        res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
        res.end(bigPage('Big Page Title'));
        return;

      case '/latin1':
        res.writeHead(200, { 'Content-Type': 'text/html; charset=iso-8859-1' });
        res.end(Buffer.from(bigPage('Café Münster'), 'latin1'));
        return;

      case '/bogus-charset':
        res.writeHead(200, { 'Content-Type': 'text/html; charset=nonsense-9000' });
        res.end('<html><head><title>Fallback Wörks</title></head></html>');
        return;

      case '/no-head-close':
        // Never closes <head>, so only the byte backstop can stop the read.
        res.writeHead(200, { 'Content-Type': 'text/html' });
        res.end('<html><head>' + '<meta name=x content=y>'.repeat(200_000));
        return;

      case '/stall':
        // Headers plus a partial body, then nothing, forever.
        res.writeHead(200, { 'Content-Type': 'text/html' });
        res.write('<html><head><title>Never');
        return;

      case '/xhtml':
        res.writeHead(200, { 'Content-Type': 'application/xhtml+xml' });
        res.end('<html><head><title>XHTML Title</title></head></html>');
        return;

      case '/pdf':
        res.writeHead(200, { 'Content-Type': 'application/pdf' });
        res.end('%PDF-1.7 definitely not html');
        return;

      case '/no-content-type':
        res.writeHead(200);
        res.end('<html><head><title>Untyped</title></head></html>');
        return;

      case '/no-charset':
        res.writeHead(200, { 'Content-Type': 'text/html' });
        res.end('<html><head><title>Ünicode Default</title></head></html>');
        return;

      case '/no-title':
        res.writeHead(200, { 'Content-Type': 'text/html' });
        res.end('<html><head><meta name=x content=y></head><body>x</body></html>');
        return;

      case '/unclosed-title':
        // Stream ends cleanly, but `</title>` never arrives.
        res.writeHead(200, { 'Content-Type': 'text/html' });
        res.end('<html><head><title>Unclosed Title');
        return;

      case '/dangling-title-head':
        // `</head>` inside `<title>` is RCDATA, so there is no title element.
        res.writeHead(200, { 'Content-Type': 'text/html' });
        res.end('<html><head><title>Oops</head><body>x</body></html>');
        return;

      case '/endless-title':
        // Opens a title and never closes it, well past any backstop.
        res.writeHead(200, { 'Content-Type': 'text/html' });
        res.end('<html><head><title>Real Beginning' + 'X'.repeat(2_000_000));
        return;

      case '/empty-body':
        res.writeHead(200, { 'Content-Type': 'text/html' });
        res.end('');
        return;

      case '/duplicate-content-type':
        res.writeHead(200, {
          'Content-Type': ['text/html', 'text/html; charset=utf-8'],
        });
        res.end('<html><head><title>Duplicated Header</title></head></html>');
        return;

      case '/204':
        res.writeHead(204, { 'Content-Type': 'text/html' });
        res.end();
        return;

      case '/404':
        res.writeHead(404, { 'Content-Type': 'text/html' });
        res.end('nope');
        return;

      case '/500':
        res.writeHead(500, { 'Content-Type': 'text/html' });
        res.end('boom');
        return;

      case '/403':
        res.writeHead(403, { 'Content-Type': 'text/html' });
        res.end('denied');
        return;

      default:
        res.writeHead(200, { 'Content-Type': 'text/html' });
        res.end(`<html><head><title>Path ${url}</title></head></html>`);
    }
  });

  await new Promise<void>((resolve) => {
    server.listen(0, '127.0.0.1', resolve);
  });
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});

afterAll(async () => {
  await new Promise<void>((resolve) => {
    server.closeAllConnections?.();
    server.close(() => resolve());
  });
});

beforeAll(() => {
  received = [];
});

describe('fetchHtml', () => {
  describe('successful requests', () => {
    it('fetches HTML from a URL string', async () => {
      const html = await fetchHtml(`${base}/`);
      expect(html).toContain('<title>Simple Title</title>');
    });

    it('fetches HTML from a URL object', async () => {
      const html = await fetchHtml(new URL(`${base}/page`));
      expect(html).toContain('<title>Path /page</title>');
    });

    it('sends the default User-Agent header', async () => {
      received = [];
      await fetchHtml(`${base}/`);
      expect(received.at(-1)?.headers['user-agent']).toBe(DEFAULT_USER_AGENT);
    });

    it('uses a custom User-Agent when provided', async () => {
      received = [];
      await fetchHtml(`${base}/`, { userAgent: 'CustomBot/2.0' });
      expect(received.at(-1)?.headers['user-agent']).toBe('CustomBot/2.0');
    });

    it('accepts application/xhtml+xml', async () => {
      const html = await fetchHtml(`${base}/xhtml`);
      expect(parseTitle(html)).toBe('XHTML Title');
    });
  });

  describe('error handling', () => {
    it.each([
      ['/404', 'HTTP 404: Not Found'],
      ['/500', 'HTTP 500: Internal Server Error'],
      ['/403', 'HTTP 403: Forbidden'],
    ])('throws for %s', async (path, message) => {
      await expect(fetchHtml(`${base}${path}`)).rejects.toThrow(message);
    });

    it('propagates connection errors', async () => {
      // Port 1 on loopback: nothing listening.
      await expect(fetchHtml('http://127.0.0.1:1/')).rejects.toThrow();
    });

    it('propagates DNS resolution errors', async () => {
      await expect(
        fetchHtml('http://does-not-exist.invalid/')
      ).rejects.toThrow();
    });
  });

  describe('content-type gate', () => {
    it('rejects a non-HTML content-type', async () => {
      await expect(fetchHtml(`${base}/pdf`)).rejects.toThrow(
        'unsupported content-type: application/pdf'
      );
    });

    it('rejects a response with no content-type', async () => {
      await expect(fetchHtml(`${base}/no-content-type`)).rejects.toThrow(
        'unsupported content-type: none'
      );
    });
  });

  describe('timeout', () => {
    it('times out a body that stalls after the headers arrive', async () => {
      // The regression guard: before the fix, the timeout was cleared once
      // headers arrived, so this hung forever.
      const started = Date.now();
      await expect(
        fetchHtml(`${base}/stall`, { timeout: 300 })
      ).rejects.toThrow('timed out after 300ms');
      expect(Date.now() - started).toBeLessThan(3000);
    });

    it('falls back to the default for a non-positive, NaN or infinite timeout', async () => {
      // AbortSignal.timeout throws RangeError for each of these raw values.
      for (const timeout of [0, -1, Number.NaN, Number.POSITIVE_INFINITY]) {
        const html = await fetchHtml(`${base}/`, { timeout });
        expect(html).toContain('Simple Title');
      }
    });

    it('floors a fractional timeout instead of throwing RangeError', async () => {
      // 1.5 floors to 1ms, so this legitimately times out — the point is that
      // it reports a timeout rather than crashing on an invalid delay.
      await expect(
        fetchHtml(`${base}/stall`, { timeout: 1.5 })
      ).rejects.toThrow('timed out after 1ms');
    });
  });

  describe('abort signal', () => {
    it('rejects when the caller signal aborts', async () => {
      const controller = new AbortController();
      const promise = fetchHtml(`${base}/stall`, { signal: controller.signal });
      controller.abort();
      await expect(promise).rejects.toThrow('request aborted');
    });

    it('still applies the timeout when a caller signal is supplied', async () => {
      // A caller signal used to disable the internal timeout entirely.
      const controller = new AbortController();
      await expect(
        fetchHtml(`${base}/stall`, { signal: controller.signal, timeout: 300 })
      ).rejects.toThrow('timed out after 300ms');
    });
  });

  describe('early stop', () => {
    it('reads a fraction of a large document and still finds the title', async () => {
      const html = await fetchHtml(`${base}/big`);

      expect(parseTitle(html)).toBe('Big Page Title');
      // The document is ~2 MB; we should be nowhere near that.
      expect(html.length).toBeLessThan(DEFAULT_MAX_BYTES);
      expect(html).not.toContain('BBBB');
    });

    it('appends nothing to the document it cut short', async () => {
      const html = await fetchHtml(`${base}/big`);
      // Parsers close open elements at EOF. Synthesizing `</head></html>`
      // instead would land inside `<title>` on the backstop path, where it is
      // RCDATA and gets extracted as part of the title.
      expect(html).not.toContain('</head></html>');
      expect(html.endsWith('</title>')).toBe(true);
    });

    it('rejects a head that exceeds the backstop rather than returning part of it', async () => {
      await expect(
        fetchHtml(`${base}/no-head-close`, { maxBytes: 64 * 1024 })
      ).rejects.toThrow('document head not closed within 65536 bytes');
    });

    it('never yields a truncated title when the backstop cuts mid-title', async () => {
      // The real risk: an HTML parser auto-closes an unterminated `<title>`,
      // so returning the partial read would produce a plausible-looking but
      // wrong title — and cache it under a default ttl of Infinity.
      await expect(
        fetchHtml(`${base}/endless-title`, { maxBytes: 4096 })
      ).rejects.toThrow('document head not closed within 4096 bytes');
    });

    it('tolerates a non-positive or NaN maxBytes', async () => {
      for (const maxBytes of [0, -1, Number.NaN]) {
        const html = await fetchHtml(`${base}/`, { maxBytes });
        expect(parseTitle(html)).toBe('Simple Title');
      }
    });

    it('clamps maxBytes into the supported range', async () => {
      // Above the ceiling: still resolves rather than costing a quadratic scan.
      for (const maxBytes of [8 * 1024 * 1024, Number.POSITIVE_INFINITY]) {
        expect(parseTitle(await fetchHtml(`${base}/`, { maxBytes }))).toBe(
          'Simple Title'
        );
      }
      // Below the floor: clamped up, not treated as zero.
      expect(parseTitle(await fetchHtml(`${base}/`, { maxBytes: 1 }))).toBe(
        'Simple Title'
      );
    });

    it('accepts a duplicated content-type header', async () => {
      const html = await fetchHtml(`${base}/duplicate-content-type`);
      expect(parseTitle(html)).toBe('Duplicated Header');
    });

    it('returns an empty string for a bodyless success', async () => {
      const html = await fetchHtml(`${base}/204`);
      expect(html).toBe('');
    });
  });

  describe('head completeness', () => {
    it('rejects a stream that ends before the head closes', async () => {
      // Indistinguishable from a dropped connection when there is no
      // Content-Length, so an unterminated title is never trusted.
      await expect(fetchHtml(`${base}/unclosed-title`)).rejects.toThrow(
        'response ended before the document head closed'
      );
    });

    it('rejects a head that closed around an unterminated title', async () => {
      await expect(fetchHtml(`${base}/dangling-title-head`)).rejects.toThrow(
        'document head closed with an unterminated <title>'
      );
    });

    it('rejects an empty body', async () => {
      await expect(fetchHtml(`${base}/empty-body`)).rejects.toThrow(
        'response ended before the document head closed'
      );
    });

    it('accepts a head that closes with no title at all', async () => {
      const html = await fetchHtml(`${base}/no-title`);
      expect(parseTitle(html)).toBeNull();
    });
  });

  describe('charset handling', () => {
    it('honors a non-UTF-8 charset from the content-type', async () => {
      const html = await fetchHtml(`${base}/latin1`);
      expect(parseTitle(html)).toBe('Café Münster');
    });

    it('falls back to UTF-8 for an unknown charset label', async () => {
      const html = await fetchHtml(`${base}/bogus-charset`);
      expect(parseTitle(html)).toBe('Fallback Wörks');
    });

    it('defaults to UTF-8 when no charset is declared', async () => {
      const html = await fetchHtml(`${base}/no-charset`);
      expect(parseTitle(html)).toBe('Ünicode Default');
    });
  });

  describe('URL handling', () => {
    it.each([
      ['/page?foo=bar&baz=qux'],
      ['/page#section'],
      ['/path%20with%20spaces'],
    ])('handles %s', async (path) => {
      const html = await fetchHtml(`${base}${path}`);
      expect(parseTitle(html)).toBeTruthy();
    });
  });
});
