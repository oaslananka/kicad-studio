const DEFAULT_COMPONENT_SEARCH_TIMEOUT_MS = 15_000;

export async function fetchWithTimeout(
  input: RequestInfo | URL,
  init: RequestInit = {},
  timeoutMs = DEFAULT_COMPONENT_SEARCH_TIMEOUT_MS
): Promise<Response> {
  const controller = new AbortController();
  const timeout = setTimeout(() => {
    controller.abort();
  }, timeoutMs);

  try {
    return await fetch(input, {
      ...init,
      signal: controller.signal
    });
  } catch (error) {
    if (error instanceof DOMException && error.name === 'AbortError') {
      throw new Error(`Component search request timed out after ${timeoutMs}ms.`, { cause: error });
    }
    throw error;
  } finally {
    clearTimeout(timeout);
  }
}
