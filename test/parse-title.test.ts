import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('isomorphic-dompurify', () => ({
  default: {
    sanitize: vi.fn((html: string) => {
      return html
        .replace(/<script[^>]*>[\s\S]*?<\/script>/gi, '')
        .replace(/<body[^>]*>[\s\S]*?<\/body>/gi, '');
    }),
  },
}));

import {
  parseTitle,
  sanitizeHtml,
  extractTitleFromHtml,
  isValidHtmlInput,
  SANITIZE_CONFIG,
} from '../src/parse-title.js';

describe('SANITIZE_CONFIG', () => {
  it('has the expected structure', () => {
    expect(SANITIZE_CONFIG.WHOLE_DOCUMENT).toBe(true);
    expect(SANITIZE_CONFIG.ALLOWED_TAGS).toContain('title');
    expect(SANITIZE_CONFIG.ALLOWED_TAGS).toContain('head');
    expect(SANITIZE_CONFIG.ALLOWED_TAGS).toContain('html');
    expect(SANITIZE_CONFIG.FORBID_TAGS).toContain('body');
  });

  it('disallows all attributes', () => {
    expect(SANITIZE_CONFIG.ALLOWED_ATTR).toEqual([]);
  });
});

describe('isValidHtmlInput', () => {
  it('accepts non-empty strings', () => {
    expect(isValidHtmlInput('<html></html>')).toBe(true);
    expect(isValidHtmlInput('a')).toBe(true);
    expect(isValidHtmlInput(' ')).toBe(true);
  });

  it('rejects empty string', () => {
    expect(isValidHtmlInput('')).toBe(false);
  });

  it('rejects null and undefined', () => {
    expect(isValidHtmlInput(null)).toBe(false);
    expect(isValidHtmlInput(undefined)).toBe(false);
  });

  it('rejects numbers', () => {
    expect(isValidHtmlInput(123)).toBe(false);
    expect(isValidHtmlInput(0)).toBe(false);
    expect(isValidHtmlInput(NaN)).toBe(false);
  });

  it('rejects objects and arrays', () => {
    expect(isValidHtmlInput({})).toBe(false);
    expect(isValidHtmlInput([])).toBe(false);
  });

  it('rejects booleans', () => {
    expect(isValidHtmlInput(true)).toBe(false);
    expect(isValidHtmlInput(false)).toBe(false);
  });
});

describe('extractTitleFromHtml', () => {
  it('extracts a title from valid HTML', () => {
    const html = '<html><head><title>Test Page Title</title></head></html>';
    expect(extractTitleFromHtml(html)).toBe('Test Page Title');
  });

  it('extracts a title from minimal HTML', () => {
    expect(extractTitleFromHtml('<title>Simple Title</title>')).toBe('Simple Title');
  });

  it('trims whitespace', () => {
    expect(extractTitleFromHtml('<title>  Title with spaces  </title>')).toBe(
      'Title with spaces'
    );
  });

  it('decodes entities', () => {
    expect(extractTitleFromHtml('<title>Title &amp; Subtitle</title>')).toBe(
      'Title & Subtitle'
    );
    expect(extractTitleFromHtml('<title>&lt;Test&gt;</title>')).toBe('<Test>');
  });

  it('returns the first title when multiple exist', () => {
    const html = '<head><title>First</title><title>Second</title></head>';
    expect(extractTitleFromHtml(html)).toBe('First');
  });

  it('handles case-insensitive title tags', () => {
    expect(extractTitleFromHtml('<TITLE>Uppercase</TITLE>')).toBe('Uppercase');
    expect(extractTitleFromHtml('<Title>Mixed Case</Title>')).toBe('Mixed Case');
  });

  it('returns null for empty title', () => {
    expect(extractTitleFromHtml('<title></title>')).toBeNull();
  });

  it('returns null for whitespace-only title', () => {
    expect(extractTitleFromHtml('<title>   </title>')).toBeNull();
  });

  it('returns null for HTML without a title', () => {
    expect(extractTitleFromHtml('<html><head></head></html>')).toBeNull();
  });

  it('handles emojis and special characters', () => {
    expect(extractTitleFromHtml('<title>émojis 🚀 spéciâl!</title>')).toBe(
      'émojis 🚀 spéciâl!'
    );
  });
});

describe('sanitizeHtml', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('returns a string', () => {
    expect(typeof sanitizeHtml('<title>Test</title>')).toBe('string');
  });
});

describe('parseTitle', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('extracts a title from valid HTML', () => {
    const html =
      '<html><head><title>Test Page Title</title></head><body></body></html>';
    expect(parseTitle(html)).toBe('Test Page Title');
  });

  it('returns null for HTML without a title', () => {
    const html =
      '<html><head><meta charset="utf-8"></head><body>No title here</body></html>';
    expect(parseTitle(html)).toBeNull();
  });

  it('returns null for empty title', () => {
    expect(parseTitle('<title></title>')).toBeNull();
  });

  it('strips scripts before extracting', () => {
    const html = `
      <html>
        <head>
          <title>Safe Title</title>
          <script>alert('xss')</script>
        </head>
      </html>
    `;
    expect(parseTitle(html)).toBe('Safe Title');
  });

  it('returns null for null/undefined/non-string input', () => {
    expect(parseTitle(null as unknown as string)).toBeNull();
    expect(parseTitle(undefined as unknown as string)).toBeNull();
    expect(parseTitle(123 as unknown as string)).toBeNull();
    expect(parseTitle({} as unknown as string)).toBeNull();
    expect(parseTitle('')).toBeNull();
  });

  it('returns null when sanitization throws', async () => {
    const dompurify = await import('isomorphic-dompurify');
    const originalSanitize = dompurify.default.sanitize;

    vi.mocked(dompurify.default.sanitize).mockImplementationOnce(() => {
      throw new Error('Sanitization failed');
    });

    expect(parseTitle('<title>Test</title>')).toBeNull();

    vi.mocked(dompurify.default.sanitize).mockImplementation(originalSanitize);
  });
});
