import * as cheerio from 'cheerio';
import DOMPurify from 'isomorphic-dompurify';

export function sanitizeHtml(html: string): string {
  return DOMPurify.sanitize(html, {
    WHOLE_DOCUMENT: true,
    ALLOWED_TAGS: ['html', 'head', 'title'],
    FORBID_TAGS: ['body'],
    FORBID_CONTENTS: ['body'],
    ALLOWED_ATTR: [],
    ALLOW_SELF_CLOSE_IN_ATTR: true,
    KEEP_CONTENT: true,
    RETURN_DOM: false,
    RETURN_DOM_FRAGMENT: false
  });
}


/**
 * Parses and extracts the title from HTML content
 * @param html - Raw HTML content to parse
 * @returns The extracted title or null if not found
 */
export function parseTitle(html: string): string | null {
  if (!html || typeof html !== 'string') {
    return null;
  }

  try {
    // Sanitize HTML to prevent potential security issues
    // Only allow essential tags needed for title extraction
    const sanitizedHtml = sanitizeHtml(html);

    // Use Cheerio to parse sanitized HTML and extract title
    const $ = cheerio.load(sanitizedHtml);
    const title = $('title').first().text().trim();

    return title || null;
  } catch (error) {
    // Handle parsing errors gracefully
    return null;
  }
}
