import { describe, it, expect } from 'vitest';
import DOMPurify from 'isomorphic-dompurify';

import { parseTitle, sanitizeHtml } from '../src/parse-title.js';

/**
 * These exercise the *real* DOMPurify + cheerio pipeline.
 *
 * `parse-title.test.ts` mocks `isomorphic-dompurify` so it can run without
 * jsdom, which means it cannot catch a behaviour change in the sanitizer
 * itself. Since the sanitizer is the security boundary for third-party HTML,
 * and since isomorphic-dompurify releases every DOMPurify change as a minor,
 * these tests pin the actual behaviour across upgrades.
 */
describe('parse-title against the real sanitizer', () => {
  it('runs on a working DOMPurify', () => {
    expect(DOMPurify.isSupported).toBe(true);
    expect(DOMPurify.version).toMatch(/^\d+\.\d+\.\d+/);
  });

  describe('title extraction', () => {
    it.each([
      ['plain title', '<html><head><title>Plain</title></head></html>', 'Plain'],
      [
        'title after a script in head',
        '<html><head><script>alert(1)</script><title>After Script</title></head></html>',
        'After Script',
      ],
      [
        'style and link stripped',
        '<html><head><link rel=stylesheet href=x><style>b{}</style><title>Styled</title></head></html>',
        'Styled',
      ],
      [
        'comment before the title',
        '<html><head><!-- note --><title>Commented</title></head></html>',
        'Commented',
      ],
      [
        'attributes on the title tag',
        '<html><head><title lang="en" dir="ltr">Attrs</title></head></html>',
        'Attrs',
      ],
      [
        'entities decoded',
        '<html><head><title>Tom &amp; Jerry &lt;b&gt;</title></head></html>',
        'Tom & Jerry <b>',
      ],
      [
        'surrounding whitespace trimmed',
        '<html><head><title>   Spaced   </title></head></html>',
        'Spaced',
      ],
      [
        'unicode preserved',
        '<html><head><title>Café Münster — ✓</title></head></html>',
        'Café Münster — ✓',
      ],
      [
        'head title wins over a body title',
        '<html><head><title>Head</title></head><body><title>Body</title></body></html>',
        'Head',
      ],
    ])('extracts %s', (_name, html, expected) => {
      expect(parseTitle(html)).toBe(expected);
    });

    it.each([
      ['a title inside body only', '<html><head></head><body><title>Body</title></body></html>'],
      ['an empty title', '<html><head><title></title></head></html>'],
      ['a whitespace-only title', '<html><head><title>   </title></head></html>'],
      ['no title at all', '<html><head><meta charset="utf-8"></head></html>'],
      ['non-HTML input', 'just some text'],
      ['an empty string', ''],
    ])('returns null for %s', (_name, html) => {
      expect(parseTitle(html)).toBeNull();
    });

    it('treats markup inside the title as literal text', () => {
      // `<title>` is RCDATA, so tags inside it are never parsed as elements.
      // The angle brackets are escaped again when written to an attribute.
      expect(parseTitle('<html><head><title>A <b>bold</b> title</title></head></html>')).toBe(
        'A <b>bold</b> title'
      );
    });
  });

  describe('sanitizeHtml', () => {
    const dirty = [
      '<html><head>',
      '<script>globalThis.pwned = true</script>',
      '<title>Kept</title>',
      '</head>',
      '<body onload="globalThis.pwned = true">',
      '<img src=x onerror="globalThis.pwned = true">',
      '<svg onload="globalThis.pwned = true"></svg>',
      '</body></html>',
    ].join('');

    it('keeps only html, head and title', () => {
      const clean = sanitizeHtml(dirty).toLowerCase();

      expect(clean).toContain('<title>kept</title>');
      for (const tag of ['<script', '<img', '<svg', '<body']) {
        expect(clean).not.toContain(tag);
      }
    });

    it('strips every event-handler attribute', () => {
      const clean = sanitizeHtml(dirty).toLowerCase();
      expect(clean).not.toMatch(/\son[a-z]+=/);
    });

    it('does not execute anything while sanitizing', () => {
      const globals = globalThis as Record<string, unknown>;
      globals.pwned = false;
      sanitizeHtml(dirty);
      expect(globals.pwned).toBe(false);
      delete globals.pwned;
    });
  });
});
