interface FetchHtmlOptions {
  signal?: AbortSignal;
  timeout?: number;
  userAgent?: string;
}

export async function fetchHtml(
  url: string | URL,
  options: FetchHtmlOptions = {}
): Promise<string> {
  const {
    signal,
    timeout = 5000,
    userAgent = 'Mozilla/5.0 (compatible; TitleFetcher/1.0)'
  } = options;

  let controller: AbortController | undefined;
  let timeoutId: NodeJS.Timeout | undefined;

  try {
    // Use provided signal or create our own with timeout
    let fetchSignal = signal;

    if (!signal) {
      controller = new AbortController();
      fetchSignal = controller.signal;
      timeoutId = setTimeout(() => controller!.abort(), timeout);
    }

    const response = await fetch(url, {
      signal: fetchSignal,
      headers: {
        'User-Agent': userAgent
      }
    });

    // Clear timeout if we created it
    if (timeoutId) {
      clearTimeout(timeoutId);
    }

    if (!response.ok) {
      throw new Error(`HTTP ${response.status}: ${response.statusText}`);
    }

    return await response.text();
  } catch (error) {
    // Clear timeout if we created it
    if (timeoutId) {
      clearTimeout(timeoutId);
    }
    throw error;
  }
}
