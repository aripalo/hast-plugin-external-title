import * as cheerio from 'cheerio';
import DOMPurify from 'isomorphic-dompurify';

/** DOMPurify configuration for title extraction — strips everything except title-related tags. */
export const SANITIZE_CONFIG = {
  WHOLE_DOCUMENT: true,
  ALLOWED_TAGS: ['html', 'head', 'title'],
  FORBID_TAGS: ['body'],
  FORBID_CONTENTS: ['body'],
  ALLOWED_ATTR: [] as string[],
  ALLOW_SELF_CLOSE_IN_ATTR: true,
  KEEP_CONTENT: true,
  RETURN_DOM: false,
  RETURN_DOM_FRAGMENT: false,
};

/** Sanitizes HTML, keeping only title-related tags. */
export function sanitizeHtml(html: string): string {
  return DOMPurify.sanitize(html, SANITIZE_CONFIG);
}

/**
 * Extracts the first `<title>` text from HTML using Cheerio.
 *
 * @returns The trimmed title text, or `null` if not found / empty.
 */
export function extractTitleFromHtml(html: string): string | null {
  const $ = cheerio.load(html);
  const title = $('title').first().text().trim();
  return title || null;
}

/** Validates that input is a non-empty string. */
export function isValidHtmlInput(html: unknown): html is string {
  return typeof html === 'string' && html.length > 0;
}

/**
 * Sanitizes the input HTML and extracts the page title.
 *
 * @returns The extracted title, or `null` if it could not be determined.
 */
export function parseTitle(html: string): string | null {
  if (!isValidHtmlInput(html)) {
    return null;
  }

  try {
    const sanitizedHtml = sanitizeHtml(html);
    return extractTitleFromHtml(sanitizedHtml);
  } catch {
    return null;
  }
}
