import type { FetchOptions } from './types.js';

/** Default `User-Agent` used when none is supplied via options. */
export const DEFAULT_USER_AGENT = 'Mozilla/5.0 (compatible; TitleFetcher/1.0)';

/** Default request timeout in milliseconds. */
export const DEFAULT_TIMEOUT = 5000;

/**
 * Fetches the raw response body of a URL as text.
 *
 * If no `signal` is provided, an internal `AbortController` enforces the
 * `timeout`. If a `signal` is provided, the caller is responsible for
 * cancellation and the internal timeout is skipped.
 */
export async function fetchHtml(
  url: string | URL,
  options: FetchOptions = {}
): Promise<string> {
  const {
    signal,
    timeout = DEFAULT_TIMEOUT,
    userAgent = DEFAULT_USER_AGENT,
  } = options;

  let controller: AbortController | undefined;
  let timeoutId: ReturnType<typeof setTimeout> | undefined;

  try {
    let fetchSignal = signal;

    if (!signal) {
      controller = new AbortController();
      fetchSignal = controller.signal;
      timeoutId = setTimeout(() => controller!.abort(), timeout);
    }

    const response = await fetch(url, {
      signal: fetchSignal,
      headers: {
        'User-Agent': userAgent,
      },
    });

    if (timeoutId) {
      clearTimeout(timeoutId);
    }

    if (!response.ok) {
      throw new Error(`HTTP ${response.status}: ${response.statusText}`);
    }

    return await response.text();
  } catch (error) {
    if (timeoutId) {
      clearTimeout(timeoutId);
    }
    throw error;
  }
}
