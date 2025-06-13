import { describe, it, expect } from 'vitest';
import { parseTitle, sanitizeHtml } from './parse-title';

describe('sanitizeHtml', () => {
  it('should sanitize HTML', () => {
    const html = '<html><head><title>Test Page Title</title></head><body><h1>Hello World!</h1></body></html>';
    expect(sanitizeHtml(html)).toBe('<html><head><title>Test Page Title</title></head></html>');
  });
});

describe('parseTitle', () => {
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

  // it('should handle malformed HTML gracefully', () => {
  //   const html = '<title>Broken HTML<title>Another Title</body>';
  //   expect(parseTitle(html)).toBe('Broken HTML');
  // });

  it('should sanitize malicious HTML and extract title', () => {
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
    expect(parseTitle(null as any)).toBeNull();
  });

  it('should return null for undefined input', () => {
    expect(parseTitle(undefined as any)).toBeNull();
  });

  it('should return null for non-string input', () => {
    expect(parseTitle(123 as any)).toBeNull();
    expect(parseTitle({} as any)).toBeNull();
    expect(parseTitle([] as any)).toBeNull();
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
});
