import type { FetchOptions } from './types.js';

/** Default `User-Agent` used when none is supplied via options. */
export const DEFAULT_USER_AGENT = 'Mozilla/5.0 (compatible; TitleFetcher/1.0)';

/** Default total request deadline in milliseconds. */
export const DEFAULT_TIMEOUT = 5000;

/**
 * Default cap on bytes read from a response body.
 *
 * Reading normally stops far earlier — as soon as the document's title or the
 * end of its `<head>` arrives — so this only applies to documents that never
 * close their head.
 */
export const DEFAULT_MAX_BYTES = 256 * 1024;

/** Smallest accepted `maxBytes`: room for a doctype, a head and a title. */
const MIN_MAX_BYTES = 1024;

/**
 * Largest accepted `maxBytes`.
 *
 * The stop marker is searched for in the whole accumulated text once per
 * chunk, so the work grows with the square of this bound. It exists to cap a
 * pathological document, not to raise the read limit, so it is clamped rather
 * than trusted.
 */
const MAX_MAX_BYTES = 1024 * 1024;

/**
 * Largest delay `AbortSignal.timeout` accepts without silently degrading.
 *
 * Unlike `setTimeout` it throws `RangeError` for a non-integral, negative or
 * out-of-range delay, which is why timeouts are normalized before use.
 */
const MAX_TIMEOUT = 2_147_483_647;

/** Content types we are willing to parse as markup. */
const HTML_CONTENT_TYPE =
  /^\s*(?:text\/html|application\/xhtml\+xml)\s*(?:;|$)/i;

/**
 * Everything we need has arrived once we have seen a complete `<title>`
 * element or the end of the `<head>`.
 *
 * Requiring the closing tag to be *paired* with an opening one matters: a
 * stray `</title>` inside a comment or an attribute value would otherwise cut
 * the document short before the real title. Trailing whitespace is bounded so
 * a hostile response cannot stretch the matched marker.
 */
const STOP_MARKER = /<title[^>]*>[\s\S]*?<\/title\s{0,32}>|<\/head\s{0,32}>/i;

/**
 * Normalizes `timeout` into a delay `AbortSignal.timeout` accepts.
 *
 * `NaN` and non-positive values fall back to the default; `Infinity` clamps to
 * the platform maximum, which is the closest thing to "no deadline".
 */
function normalizeTimeout(timeout: number | undefined): number {
  if (timeout === undefined || Number.isNaN(timeout) || timeout <= 0) {
    return DEFAULT_TIMEOUT;
  }
  if (!Number.isFinite(timeout)) return MAX_TIMEOUT;
  return Math.min(Math.floor(timeout), MAX_TIMEOUT);
}

/** Clamps `maxBytes` into the supported range, treating `NaN` as the default. */
function normalizeMaxBytes(maxBytes: number | undefined): number {
  if (maxBytes === undefined || Number.isNaN(maxBytes)) {
    return DEFAULT_MAX_BYTES;
  }
  if (!Number.isFinite(maxBytes)) return MAX_MAX_BYTES;
  return Math.min(Math.max(Math.floor(maxBytes), MIN_MAX_BYTES), MAX_MAX_BYTES);
}

/**
 * Returns `true` when `header` declares markup we can parse.
 *
 * `Headers.get` joins repeated `Content-Type` headers with `', '`, and the
 * first value is the authoritative one — so only that is tested. Otherwise a
 * proxy that duplicated a perfectly good `text/html` would fail the check.
 */
function isHtmlContentType(header: string): boolean {
  const [first = ''] = header.split(',');
  return HTML_CONTENT_TYPE.test(first);
}

/**
 * Builds a decoder honoring the response's declared charset.
 *
 * We read the body as bytes rather than calling `response.text()` — which
 * always decodes as UTF-8 and cannot stop early — so the charset handling
 * `text()` would *not* have done has to happen here. An unknown label makes
 * `TextDecoder` throw, so fall back to UTF-8.
 */
function decoderFor(contentType: string): TextDecoder {
  const label = /charset=\s*"?([^";,\s]+)"?/i.exec(contentType)?.[1];
  if (!label) return new TextDecoder();
  try {
    return new TextDecoder(label);
  } catch {
    return new TextDecoder();
  }
}

/** Releases a response body we are not going to read. */
async function discard(response: Response): Promise<void> {
  try {
    await response.body?.cancel();
  } catch {
    // Already errored, locked or consumed: nothing left to release.
  }
}

/**
 * Reads just enough of the body to contain the title.
 *
 * Stops at {@link STOP_MARKER}, or at `maxBytes` for a document that never
 * closes its head.
 *
 * Nothing is appended to a truncated document. HTML parsers close open
 * elements at EOF on their own, whereas a synthetic `</head></html>` lands
 * *inside* `<title>` whenever the backstop cuts mid-title — where it is
 * RCDATA, not markup, and would be extracted as part of the title.
 */
async function readDocumentHead(
  body: ReadableStream<Uint8Array>,
  maxBytes: number,
  decoder: TextDecoder
): Promise<string> {
  const reader = body.getReader();
  let text = '';
  let bytes = 0;

  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;

      bytes += value.byteLength;
      // `stream: true` holds back a multi-byte character split across a chunk
      // boundary instead of emitting U+FFFD for each half.
      text += decoder.decode(value, { stream: true });

      // Cut at the marker rather than merely stopping the read: a server is
      // free to deliver the whole document in one chunk, and without this the
      // entire body would be kept. Scanning the accumulated string is
      // quadratic in principle, which is what `maxBytes` bounds.
      const stop = STOP_MARKER.exec(text);
      if (stop) {
        // The text ends at `>`, so any bytes the decoder still holds belong to
        // content we are discarding — no final flush needed.
        return text.slice(0, stop.index + stop[0].length);
      }

      if (bytes >= maxBytes) break;
    }
  } finally {
    try {
      await reader.cancel();
    } catch {
      // Already closed or errored; the read result is what matters.
    }
  }

  // Flush, so a dangling multi-byte sequence becomes one U+FFFD rather than
  // silently vanishing.
  return text + decoder.decode();
}

/**
 * Fetches enough of a URL's HTML to contain its `<title>`.
 *
 * - **Total deadline.** `timeout` bounds the whole exchange — connect, headers
 *   *and* body — via `AbortSignal.timeout`, composed with any caller `signal`.
 *   A server that returns headers and then stalls the body is aborted rather
 *   than hanging the build, and supplying a `signal` no longer disables the
 *   timeout.
 * - **Strict content type.** Only `text/html` and `application/xhtml+xml` are
 *   read; anything else, including a missing header, is rejected with zero
 *   body bytes transferred.
 * - **Early stop.** Reading ends at `</title>` or `</head>`, typically a tiny
 *   fraction of a page. `maxBytes` is only a backstop.
 *
 * @returns The document head markup, or `''` for a bodyless success.
 */
export async function fetchHtml(
  url: string | URL,
  options: FetchOptions = {}
): Promise<string> {
  const { signal, userAgent = DEFAULT_USER_AGENT } = options;

  const timeout = normalizeTimeout(options.timeout);
  const maxBytes = normalizeMaxBytes(options.maxBytes);

  // Internally unref'd, so a pending deadline never holds the process open.
  const timeoutSignal = AbortSignal.timeout(timeout);
  const fetchSignal = signal
    ? AbortSignal.any([signal, timeoutSignal])
    : timeoutSignal;

  /**
   * Rethrows `error`, naming what aborted when something did.
   *
   * The reason alone cannot distinguish the two — a caller may abort with any
   * value — so the signals' own state decides, with the caller taking
   * precedence as the more actionable explanation.
   */
  function rethrow(error: unknown): never {
    if (signal?.aborted) {
      throw new Error('request aborted via fetch.signal', { cause: error });
    }
    if (timeoutSignal.aborted) {
      throw new Error(`timed out after ${timeout}ms`, { cause: error });
    }
    throw error;
  }

  const response = await fetch(url, {
    signal: fetchSignal,
    headers: {
      'User-Agent': userAgent,
    },
  }).catch(rethrow);

  if (!response.ok) {
    await discard(response);
    throw new Error(`HTTP ${response.status}: ${response.statusText}`);
  }

  const contentType = response.headers.get('content-type');
  if (contentType === null || !isHtmlContentType(contentType)) {
    await discard(response);
    throw new Error(`unsupported content-type: ${contentType ?? 'none'}`);
  }

  // Null for a bodyless success such as 204 No Content.
  if (response.body === null) return '';

  return await readDocumentHead(
    response.body,
    maxBytes,
    decoderFor(contentType)
  ).catch(rethrow);
}
