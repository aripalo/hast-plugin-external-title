import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { fetchHtml } from './fetch-html';

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
    it('should fetch HTML from a URL string', async () => {
      const htmlContent = '<html><title>Test</title></html>';
      mockFetch.mockResolvedValueOnce({
        ok: true,
        text: () => Promise.resolve(htmlContent),
      });

      const result = await fetchHtml('https://example.com');

      expect(result).toBe(htmlContent);
      expect(mockFetch).toHaveBeenCalledWith('https://example.com', expect.any(Object));
    });

    it('should fetch HTML from a URL object', async () => {
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

    it('should send default User-Agent header', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        text: () => Promise.resolve('<html></html>'),
      });

      await fetchHtml('https://example.com');

      expect(mockFetch).toHaveBeenCalledWith(
        'https://example.com',
        expect.objectContaining({
          headers: {
            'User-Agent': 'Mozilla/5.0 (compatible; TitleFetcher/1.0)',
          },
        })
      );
    });

    it('should use custom User-Agent when provided', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        text: () => Promise.resolve('<html></html>'),
      });

      await fetchHtml('https://example.com', {
        userAgent: 'CustomBot/2.0',
      });

      expect(mockFetch).toHaveBeenCalledWith(
        'https://example.com',
        expect.objectContaining({
          headers: {
            'User-Agent': 'CustomBot/2.0',
          },
        })
      );
    });
  });

  describe('error handling', () => {
    it('should throw error for non-ok response (404)', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: false,
        status: 404,
        statusText: 'Not Found',
      });

      await expect(fetchHtml('https://example.com/notfound')).rejects.toThrow(
        'HTTP 404: Not Found'
      );
    });

    it('should throw error for non-ok response (500)', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: false,
        status: 500,
        statusText: 'Internal Server Error',
      });

      await expect(fetchHtml('https://example.com/error')).rejects.toThrow(
        'HTTP 500: Internal Server Error'
      );
    });

    it('should throw error for non-ok response (403)', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: false,
        status: 403,
        statusText: 'Forbidden',
      });

      await expect(fetchHtml('https://example.com/forbidden')).rejects.toThrow(
        'HTTP 403: Forbidden'
      );
    });

    it('should propagate network errors', async () => {
      mockFetch.mockRejectedValueOnce(new Error('Network error'));

      await expect(fetchHtml('https://example.com')).rejects.toThrow('Network error');
    });

    it('should propagate DNS resolution errors', async () => {
      mockFetch.mockRejectedValueOnce(new Error('getaddrinfo ENOTFOUND example.invalid'));

      await expect(fetchHtml('https://example.invalid')).rejects.toThrow('ENOTFOUND');
    });
  });

  describe('timeout handling', () => {
    it('should pass signal to fetch', async () => {
      let capturedSignal: AbortSignal | undefined;
      mockFetch.mockImplementation((_url, options) => {
        capturedSignal = options?.signal;
        return Promise.resolve({
          ok: true,
          text: () => Promise.resolve('<html></html>'),
        });
      });

      await fetchHtml('https://example.com');

      // An AbortSignal should be passed to fetch
      expect(capturedSignal).toBeDefined();
      expect(capturedSignal).toBeInstanceOf(AbortSignal);
    });

    it('should create AbortController when no signal provided', async () => {
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
    });

    it('should clear timeout on successful response', async () => {
      vi.useRealTimers(); // Use real timers for this test
      const clearTimeoutSpy = vi.spyOn(global, 'clearTimeout');
      mockFetch.mockResolvedValueOnce({
        ok: true,
        text: () => Promise.resolve('<html></html>'),
      });

      await fetchHtml('https://example.com');

      expect(clearTimeoutSpy).toHaveBeenCalled();
      clearTimeoutSpy.mockRestore();
      vi.useFakeTimers(); // Restore fake timers
    });

    it('should clear timeout on error', async () => {
      vi.useRealTimers(); // Use real timers for this test
      const clearTimeoutSpy = vi.spyOn(global, 'clearTimeout');
      mockFetch.mockRejectedValueOnce(new Error('Network error'));

      await expect(fetchHtml('https://example.com')).rejects.toThrow();

      expect(clearTimeoutSpy).toHaveBeenCalled();
      clearTimeoutSpy.mockRestore();
      vi.useFakeTimers(); // Restore fake timers
    });

    it('should use setTimeout for timeout when no signal provided', async () => {
      vi.useRealTimers();
      const setTimeoutSpy = vi.spyOn(global, 'setTimeout');
      mockFetch.mockResolvedValueOnce({
        ok: true,
        text: () => Promise.resolve('<html></html>'),
      });

      await fetchHtml('https://example.com', { timeout: 3000 });

      // Find a setTimeout call with the custom timeout value
      const timeoutCall = setTimeoutSpy.mock.calls.find(
        (call) => call[1] === 3000
      );
      expect(timeoutCall).toBeDefined();

      setTimeoutSpy.mockRestore();
      vi.useFakeTimers();
    });
  });

  describe('abort signal handling', () => {
    it('should use provided abort signal', async () => {
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
        expect.objectContaining({
          signal: controller.signal,
        })
      );
    });

    it('should not create internal timeout when signal is provided', async () => {
      const setTimeoutSpy = vi.spyOn(global, 'setTimeout');
      const controller = new AbortController();

      mockFetch.mockResolvedValueOnce({
        ok: true,
        text: () => Promise.resolve('<html></html>'),
      });

      await fetchHtml('https://example.com', { signal: controller.signal });

      // setTimeout should not be called for timeout when external signal is provided
      const timeoutCalls = setTimeoutSpy.mock.calls.filter(
        (call) => typeof call[1] === 'number' && call[1] >= 1000
      );
      expect(timeoutCalls).toHaveLength(0);

      setTimeoutSpy.mockRestore();
    });

    it('should handle abort from provided signal', async () => {
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
    it('should handle URLs with query parameters', async () => {
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

    it('should handle URLs with hash fragments', async () => {
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

    it('should handle URLs with ports', async () => {
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

    it('should handle URLs with special characters (encoded)', async () => {
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

