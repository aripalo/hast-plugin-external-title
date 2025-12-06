import * as cheerio from 'cheerio';
import DOMPurify from 'isomorphic-dompurify';

/** DOMPurify configuration for title extraction - strips everything except title-related tags */
export const SANITIZE_CONFIG = {
  WHOLE_DOCUMENT: true,
  ALLOWED_TAGS: ['html', 'head', 'title'],
  FORBID_TAGS: ['body'],
  FORBID_CONTENTS: ['body'],
  ALLOWED_ATTR: [],
  ALLOW_SELF_CLOSE_IN_ATTR: true,
  KEEP_CONTENT: true,
  RETURN_DOM: false,
  RETURN_DOM_FRAGMENT: false,
} as const;

/**
 * Sanitizes HTML content using DOMPurify, keeping only title-related tags
 */
export function sanitizeHtml(html: string): string {
  return DOMPurify.sanitize(html, SANITIZE_CONFIG);
}

/**
 * Extracts the title text from HTML content using Cheerio
 * @param html - HTML content (can be sanitized or raw)
 * @returns The extracted title text or null if not found/empty
 */
export function extractTitleFromHtml(html: string): string | null {
  const $ = cheerio.load(html);
  const title = $('title').first().text().trim();
  return title || null;
}

/**
 * Validates that input is a non-empty string
 */
export function isValidHtmlInput(html: unknown): html is string {
  return typeof html === 'string' && html.length > 0;
}

/**
 * Parses and extracts the title from HTML content
 * @param html - Raw HTML content to parse
 * @returns The extracted title or null if not found
 */
export function parseTitle(html: string): string | null {
  if (!isValidHtmlInput(html)) {
    return null;
  }

  try {
    // Sanitize HTML to prevent potential security issues
    // Only allow essential tags needed for title extraction
    const sanitizedHtml = sanitizeHtml(html);

    // Extract title from sanitized HTML
    return extractTitleFromHtml(sanitizedHtml);
  } catch {
    // Handle parsing errors gracefully
    return null;
  }
}
