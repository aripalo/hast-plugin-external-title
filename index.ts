import type { Element, Root } from 'hast';
import { visit } from 'unist-util-visit';
import { fetchHtml } from './fetch-html';
import { parseTitle } from './parse-title';
import { getTitle, setTitle } from './database';

interface LinkInfo {
  element: Element;
  href: string;
}

// Cache to avoid fetching the same URL multiple times
const titleCache = new Map<string, string>();

export function rehypeExtlink() {
  return async (tree: Root) => {
    const externalLinks: LinkInfo[] = [];

    // Find all external links
    visit(tree, 'element', (node: Element) => {
      if (node.tagName === 'a' && node.properties?.href) {
        const href = String(node.properties.href);
        if (href.startsWith('https://') || href.startsWith('http://')) {
          externalLinks.push({ element: node, href });
        }
      }
    });

    // Fetch titles for all external links
    const titlePromises = externalLinks.map(async ({ element, href }) => {
      try {
        // Check in-memory cache first (for this run)
        if (titleCache.has(href)) {
          const title = titleCache.get(href);
          if (title) {
            element.properties = element.properties || {};
            element.properties.title = title;
          }
          return;
        }

        // Check database cache
        const dbResult = await getTitle(href);

        if (dbResult.exists && dbResult.entry) {
          if ('title' in dbResult.entry && dbResult.entry.title) {
            // Database has a valid title (Entry type)
            titleCache.set(href, dbResult.entry.title);
            element.properties = element.properties || {};
            element.properties.title = dbResult.entry.title;
            element.properties['data-title-updated-at'] = dbResult.entry.updatedAt;
          }
          // If it's an EntryError or Entry with null title, skip trying to fetch again
          return;
        }

        // Key doesn't exist in database, fetch the title
        const title = await fetchPageTitle(href);

        // Update database with result (could be null if fetch failed)
        await setTitle(href, title);

        if (title) {
          titleCache.set(href, title);
          element.properties = element.properties || {};
          element.properties.title = title;
          element.properties['data-title-updated-at'] = new Date().toISOString();
        }
      } catch (error) {
        console.warn(`Failed to fetch title for ${href}:`, error);
        // Continue gracefully without setting title
      }
    });

    // Wait for all title fetches to complete
    await Promise.all(titlePromises);
  };
}

async function fetchPageTitle(url: string | URL): Promise<string | null> {
  try {
    const html = await fetchHtml(url);
    return parseTitle(html);
  } catch (error) {
    // Handle timeout, network errors, etc.
    return null;
  }
}
