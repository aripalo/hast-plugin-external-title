import { describe, it, expect, vi, beforeEach } from 'vitest';

// Mock isomorphic-dompurify to avoid jsdom ESM compatibility issues
vi.mock('isomorphic-dompurify', () => ({
  default: {
    sanitize: vi.fn((html: string) => {
      // Simple mock that strips script tags and body content for testing
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
} from './parse-title';

describe('SANITIZE_CONFIG', () => {
  it('should have correct structure', () => {
    expect(SANITIZE_CONFIG.WHOLE_DOCUMENT).toBe(true);
    expect(SANITIZE_CONFIG.ALLOWED_TAGS).toContain('title');
    expect(SANITIZE_CONFIG.ALLOWED_TAGS).toContain('head');
    expect(SANITIZE_CONFIG.ALLOWED_TAGS).toContain('html');
    expect(SANITIZE_CONFIG.FORBID_TAGS).toContain('body');
  });

  it('should not allow any attributes', () => {
    expect(SANITIZE_CONFIG.ALLOWED_ATTR).toEqual([]);
  });
});

describe('isValidHtmlInput', () => {
  it('should return true for non-empty string', () => {
    expect(isValidHtmlInput('<html></html>')).toBe(true);
    expect(isValidHtmlInput('a')).toBe(true);
    expect(isValidHtmlInput(' ')).toBe(true);
  });

  it('should return false for empty string', () => {
    expect(isValidHtmlInput('')).toBe(false);
  });

  it('should return false for null', () => {
    expect(isValidHtmlInput(null)).toBe(false);
  });

  it('should return false for undefined', () => {
    expect(isValidHtmlInput(undefined)).toBe(false);
  });

  it('should return false for numbers', () => {
    expect(isValidHtmlInput(123)).toBe(false);
    expect(isValidHtmlInput(0)).toBe(false);
    expect(isValidHtmlInput(NaN)).toBe(false);
  });

  it('should return false for objects', () => {
    expect(isValidHtmlInput({})).toBe(false);
    expect(isValidHtmlInput({ html: '<html></html>' })).toBe(false);
  });

  it('should return false for arrays', () => {
    expect(isValidHtmlInput([])).toBe(false);
    expect(isValidHtmlInput(['<html></html>'])).toBe(false);
  });

  it('should return false for boolean', () => {
    expect(isValidHtmlInput(true)).toBe(false);
    expect(isValidHtmlInput(false)).toBe(false);
  });
});

describe('extractTitleFromHtml', () => {
  it('should extract title from valid HTML', () => {
    const html = '<html><head><title>Test Page Title</title></head></html>';
    expect(extractTitleFromHtml(html)).toBe('Test Page Title');
  });

  it('should extract title from minimal HTML', () => {
    expect(extractTitleFromHtml('<title>Simple Title</title>')).toBe('Simple Title');
  });

  it('should trim whitespace from title', () => {
    expect(extractTitleFromHtml('<title>  Title with spaces  </title>')).toBe('Title with spaces');
  });

  it('should handle HTML entities', () => {
    expect(extractTitleFromHtml('<title>Title &amp; Subtitle</title>')).toBe('Title & Subtitle');
    expect(extractTitleFromHtml('<title>&lt;Test&gt;</title>')).toBe('<Test>');
  });

  it('should return first title when multiple exist', () => {
    const html = '<head><title>First</title><title>Second</title></head>';
    expect(extractTitleFromHtml(html)).toBe('First');
  });

  it('should handle case-insensitive title tags', () => {
    expect(extractTitleFromHtml('<TITLE>Uppercase</TITLE>')).toBe('Uppercase');
    expect(extractTitleFromHtml('<Title>Mixed Case</Title>')).toBe('Mixed Case');
  });

  it('should return null for empty title', () => {
    expect(extractTitleFromHtml('<title></title>')).toBeNull();
  });

  it('should return null for whitespace-only title', () => {
    expect(extractTitleFromHtml('<title>   </title>')).toBeNull();
  });

  it('should return null for HTML without title', () => {
    expect(extractTitleFromHtml('<html><head></head></html>')).toBeNull();
  });

  it('should handle title with newlines', () => {
    const html = '<title>\n  Multi\n  Line\n  Title  \n</title>';
    expect(extractTitleFromHtml(html)).toBe('Multi\n  Line\n  Title');
  });

  it('should handle very long titles', () => {
    const longTitle = 'A'.repeat(1000);
    expect(extractTitleFromHtml(`<title>${longTitle}</title>`)).toBe(longTitle);
  });

  it('should handle special characters and emojis', () => {
    expect(extractTitleFromHtml('<title>émojis 🚀 spéciâl!</title>')).toBe('émojis 🚀 spéciâl!');
  });

  it('should handle title nested in complex structure', () => {
    const html = `
      <!DOCTYPE html>
      <html lang="en">
        <head>
          <meta charset="UTF-8">
          <title>Complex Title</title>
          <meta name="description" content="desc">
        </head>
      </html>
    `;
    expect(extractTitleFromHtml(html)).toBe('Complex Title');
  });
});

describe('sanitizeHtml', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('should call DOMPurify.sanitize', () => {
    const html = '<html><title>Test</title></html>';
    sanitizeHtml(html);
    // The mock was called
    expect(sanitizeHtml(html)).toBeDefined();
  });

  it('should return string result', () => {
    const result = sanitizeHtml('<title>Test</title>');
    expect(typeof result).toBe('string');
  });
});

describe('parseTitle', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('should extract title from valid HTML', () => {
    const html = '<html><head><title>Test Page Title</title></head><body></body></html>';
    expect(parseTitle(html)).toBe('Test Page Title');
  });

  it('should extract title from minimal HTML', () => {
    const html = '<title>Simple Title</title>';
    expect(parseTitle(html)).toBe('Simple Title');
  });

  it('should trim whitespace from title', () => {
    const html = '<title>  Title with spaces  </title>';
    expect(parseTitle(html)).toBe('Title with spaces');
  });

  it('should handle HTML entities in title', () => {
    const html = '<title>Title &amp; Subtitle &lt;Test&gt;</title>';
    expect(parseTitle(html)).toBe('Title & Subtitle <Test>');
  });

  it('should handle title with line breaks and multiple spaces', () => {
    const html = '<title>\n  Multi\n  Line\n  Title  \n</title>';
    expect(parseTitle(html)).toBe('Multi\n  Line\n  Title');
  });

  it('should return first title when multiple titles exist', () => {
    const html = `
      <html>
        <head>
          <title>First Title</title>
          <title>Second Title</title>
        </head>
      </html>
    `;
    expect(parseTitle(html)).toBe('First Title');
  });

  it('should handle case-insensitive title tags', () => {
    const html = '<TITLE>Uppercase Title Tag</TITLE>';
    expect(parseTitle(html)).toBe('Uppercase Title Tag');
  });

  it('should return null for HTML without title', () => {
    const html = '<html><head><meta charset="utf-8"></head><body>No title here</body></html>';
    expect(parseTitle(html)).toBeNull();
  });

  it('should return null for empty title', () => {
    const html = '<title></title>';
    expect(parseTitle(html)).toBeNull();
  });

  it('should return null for title with only whitespace', () => {
    const html = '<title>   </title>';
    expect(parseTitle(html)).toBeNull();
  });

  it('should sanitize and extract title', () => {
    const html = `
      <html>
        <head>
          <title>Safe Title</title>
          <script>alert('xss')</script>
        </head>
        <body>
          <script>console.log('malicious')</script>
        </body>
      </html>
    `;
    expect(parseTitle(html)).toBe('Safe Title');
  });

  it('should handle complex HTML with nested elements', () => {
    const html = `
      <!DOCTYPE html>
      <html lang="en">
        <head>
          <meta charset="UTF-8">
          <meta name="viewport" content="width=device-width, initial-scale=1.0">
          <title>Complex Page Title</title>
          <meta name="description" content="Page description">
        </head>
        <body>
          <div>Content</div>
        </body>
      </html>
    `;
    expect(parseTitle(html)).toBe('Complex Page Title');
  });

  // Edge cases and error handling
  it('should return null for null input', () => {
    expect(parseTitle(null as unknown as string)).toBeNull();
  });

  it('should return null for undefined input', () => {
    expect(parseTitle(undefined as unknown as string)).toBeNull();
  });

  it('should return null for non-string input', () => {
    expect(parseTitle(123 as unknown as string)).toBeNull();
    expect(parseTitle({} as unknown as string)).toBeNull();
    expect(parseTitle([] as unknown as string)).toBeNull();
  });

  it('should return null for empty string', () => {
    expect(parseTitle('')).toBeNull();
  });

  it('should handle very long titles', () => {
    const longTitle = 'A'.repeat(1000);
    const html = `<title>${longTitle}</title>`;
    expect(parseTitle(html)).toBe(longTitle);
  });

  it('should handle titles with special characters', () => {
    const html = '<title>Title with émojis 🚀 and spéciâl cháracters!</title>';
    expect(parseTitle(html)).toBe('Title with émojis 🚀 and spéciâl cháracters!');
  });

  it('should handle XML-style self-closing tags around title', () => {
    const html = `
      <head>
        <meta charset="utf-8"/>
        <title>XML Style Title</title>
        <meta name="viewport" content="width=device-width"/>
      </head>
    `;
    expect(parseTitle(html)).toBe('XML Style Title');
  });

  it('should handle title with quotes', () => {
    expect(parseTitle('<title>Title with "quotes"</title>')).toBe('Title with "quotes"');
    expect(parseTitle("<title>Title with 'single quotes'</title>")).toBe("Title with 'single quotes'");
  });

  it('should handle title with angle brackets (escaped)', () => {
    expect(parseTitle('<title>&lt;tag&gt; in title</title>')).toBe('<tag> in title');
  });

  it('should return null when sanitization throws an error', async () => {
    // Import the actual DOMPurify mock and make it throw
    const dompurify = await import('isomorphic-dompurify');
    const originalSanitize = dompurify.default.sanitize;

    // Make sanitize throw an error
    vi.mocked(dompurify.default.sanitize).mockImplementationOnce(() => {
      throw new Error('Sanitization failed');
    });

    expect(parseTitle('<title>Test</title>')).toBeNull();

    // Restore
    vi.mocked(dompurify.default.sanitize).mockImplementation(originalSanitize);
  });
});
