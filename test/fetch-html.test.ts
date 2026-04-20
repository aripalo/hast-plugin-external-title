import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { fetchHtml, DEFAULT_USER_AGENT } from '../src/fetch-html.js';

describe('fetchHtml', () => {
  const mockFetch = vi.fn();
  const originalFetch = global.fetch;

  beforeEach(() => {
    vi.useFakeTimers();
    global.fetch = mockFetch;
    mockFetch.mockReset();
  });

  afterEach(() => {
    vi.useRealTimers();
    global.fetch = originalFetch;
  });

  describe('successful requests', () => {
    it('fetches HTML from a URL string', async () => {
      const htmlContent = '<html><title>Test</title></html>';
      mockFetch.mockResolvedValueOnce({
        ok: true,
        text: () => Promise.resolve(htmlContent),
      });

      const result = await fetchHtml('https://example.com');

      expect(result).toBe(htmlContent);
      expect(mockFetch).toHaveBeenCalledWith('https://example.com', expect.any(Object));
    });

    it('fetches HTML from a URL object', async () => {
      const htmlContent = '<html><title>Test</title></html>';
      mockFetch.mockResolvedValueOnce({
        ok: true,
        text: () => Promise.resolve(htmlContent),
      });

      const url = new URL('https://example.com/page');
      const result = await fetchHtml(url);

      expect(result).toBe(htmlContent);
      expect(mockFetch).toHaveBeenCalledWith(url, expect.any(Object));
    });

    it('sends the default User-Agent header', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        text: () => Promise.resolve('<html></html>'),
      });

      await fetchHtml('https://example.com');

      expect(mockFetch).toHaveBeenCalledWith(
        'https://example.com',
        expect.objectContaining({
          headers: { 'User-Agent': DEFAULT_USER_AGENT },
        })
      );
    });

    it('uses a custom User-Agent when provided', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        text: () => Promise.resolve('<html></html>'),
      });

      await fetchHtml('https://example.com', { userAgent: 'CustomBot/2.0' });

      expect(mockFetch).toHaveBeenCalledWith(
        'https://example.com',
        expect.objectContaining({
          headers: { 'User-Agent': 'CustomBot/2.0' },
        })
      );
    });
  });

  describe('error handling', () => {
    it('throws for 404 responses', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: false,
        status: 404,
        statusText: 'Not Found',
      });

      await expect(fetchHtml('https://example.com/notfound')).rejects.toThrow(
        'HTTP 404: Not Found'
      );
    });

    it('throws for 500 responses', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: false,
        status: 500,
        statusText: 'Internal Server Error',
      });

      await expect(fetchHtml('https://example.com/error')).rejects.toThrow(
        'HTTP 500: Internal Server Error'
      );
    });

    it('throws for 403 responses', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: false,
        status: 403,
        statusText: 'Forbidden',
      });

      await expect(fetchHtml('https://example.com/forbidden')).rejects.toThrow(
        'HTTP 403: Forbidden'
      );
    });

    it('propagates network errors', async () => {
      mockFetch.mockRejectedValueOnce(new Error('Network error'));
      await expect(fetchHtml('https://example.com')).rejects.toThrow('Network error');
    });

    it('propagates DNS resolution errors', async () => {
      mockFetch.mockRejectedValueOnce(new Error('getaddrinfo ENOTFOUND example.invalid'));
      await expect(fetchHtml('https://example.invalid')).rejects.toThrow('ENOTFOUND');
    });
  });

  describe('timeout handling', () => {
    it('passes a signal to fetch', async () => {
      let capturedSignal: AbortSignal | undefined;
      mockFetch.mockImplementation((_url, options) => {
        capturedSignal = options?.signal;
        return Promise.resolve({
          ok: true,
          text: () => Promise.resolve('<html></html>'),
        });
      });

      await fetchHtml('https://example.com');

      expect(capturedSignal).toBeDefined();
      expect(capturedSignal).toBeInstanceOf(AbortSignal);
    });

    it('clears the timeout on success', async () => {
      vi.useRealTimers();
      const clearTimeoutSpy = vi.spyOn(global, 'clearTimeout');
      mockFetch.mockResolvedValueOnce({
        ok: true,
        text: () => Promise.resolve('<html></html>'),
      });

      await fetchHtml('https://example.com');

      expect(clearTimeoutSpy).toHaveBeenCalled();
      clearTimeoutSpy.mockRestore();
      vi.useFakeTimers();
    });

    it('clears the timeout on error', async () => {
      vi.useRealTimers();
      const clearTimeoutSpy = vi.spyOn(global, 'clearTimeout');
      mockFetch.mockRejectedValueOnce(new Error('Network error'));

      await expect(fetchHtml('https://example.com')).rejects.toThrow();

      expect(clearTimeoutSpy).toHaveBeenCalled();
      clearTimeoutSpy.mockRestore();
      vi.useFakeTimers();
    });

    it('uses setTimeout with the supplied timeout when no signal is provided', async () => {
      vi.useRealTimers();
      const setTimeoutSpy = vi.spyOn(global, 'setTimeout');
      mockFetch.mockResolvedValueOnce({
        ok: true,
        text: () => Promise.resolve('<html></html>'),
      });

      await fetchHtml('https://example.com', { timeout: 3000 });

      const timeoutCall = setTimeoutSpy.mock.calls.find((call) => call[1] === 3000);
      expect(timeoutCall).toBeDefined();

      setTimeoutSpy.mockRestore();
      vi.useFakeTimers();
    });

    it('aborts the request when the timeout fires', async () => {
      vi.useRealTimers();

      mockFetch.mockImplementation((_url, options) => {
        return new Promise((_, reject) => {
          if (options?.signal) {
            options.signal.addEventListener('abort', () => {
              reject(new DOMException('The operation was aborted', 'AbortError'));
            });
          }
        });
      });

      const fetchPromise = fetchHtml('https://example.com', { timeout: 10 });

      await expect(fetchPromise).rejects.toThrow('aborted');

      vi.useFakeTimers();
    });
  });

  describe('abort signal handling', () => {
    it('uses the provided abort signal verbatim', async () => {
      const controller = new AbortController();
      mockFetch.mockImplementation((_url, options) => {
        expect(options?.signal).toBe(controller.signal);
        return Promise.resolve({
          ok: true,
          text: () => Promise.resolve('<html></html>'),
        });
      });

      await fetchHtml('https://example.com', { signal: controller.signal });

      expect(mockFetch).toHaveBeenCalledWith(
        'https://example.com',
        expect.objectContaining({ signal: controller.signal })
      );
    });

    it('does not start an internal timeout when a signal is provided', async () => {
      const setTimeoutSpy = vi.spyOn(global, 'setTimeout');
      const controller = new AbortController();

      mockFetch.mockResolvedValueOnce({
        ok: true,
        text: () => Promise.resolve('<html></html>'),
      });

      await fetchHtml('https://example.com', { signal: controller.signal });

      const timeoutCalls = setTimeoutSpy.mock.calls.filter(
        (call) => typeof call[1] === 'number' && call[1] >= 1000
      );
      expect(timeoutCalls).toHaveLength(0);

      setTimeoutSpy.mockRestore();
    });

    it('rejects when the provided signal aborts', async () => {
      const controller = new AbortController();
      mockFetch.mockImplementation(() => {
        return new Promise((_, reject) => {
          controller.signal.addEventListener('abort', () => {
            reject(new DOMException('Aborted', 'AbortError'));
          });
        });
      });

      const fetchPromise = fetchHtml('https://example.com', { signal: controller.signal });
      controller.abort();

      await expect(fetchPromise).rejects.toThrow();
    });
  });

  describe('URL handling', () => {
    it('handles query parameters', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        text: () => Promise.resolve('<html></html>'),
      });

      await fetchHtml('https://example.com/page?foo=bar&baz=qux');

      expect(mockFetch).toHaveBeenCalledWith(
        'https://example.com/page?foo=bar&baz=qux',
        expect.any(Object)
      );
    });

    it('handles hash fragments', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        text: () => Promise.resolve('<html></html>'),
      });

      await fetchHtml('https://example.com/page#section');

      expect(mockFetch).toHaveBeenCalledWith(
        'https://example.com/page#section',
        expect.any(Object)
      );
    });

    it('handles ports', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        text: () => Promise.resolve('<html></html>'),
      });

      await fetchHtml('https://example.com:8080/page');

      expect(mockFetch).toHaveBeenCalledWith(
        'https://example.com:8080/page',
        expect.any(Object)
      );
    });

    it('handles encoded paths', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        text: () => Promise.resolve('<html></html>'),
      });

      await fetchHtml('https://example.com/path%20with%20spaces');

      expect(mockFetch).toHaveBeenCalledWith(
        'https://example.com/path%20with%20spaces',
        expect.any(Object)
      );
    });
  });
});
