// Rate-limit-aware fetch. Retries respect the platform's own signal first
// (via getRetryDelayMs), then the standard Retry-After header, then
// exponential backoff with jitter. Never a fixed sleep.
import { logger } from '@grossline/core';

export type RetryOptions = {
  fetchImpl?: typeof fetch;
  maxAttempts?: number;
  baseDelayMs?: number;
  maxDelayMs?: number;
  /** Platform-specific delay extraction (e.g. GraphQL throttle status). */
  getRetryDelayMs?: (res: Response, bodyText: string | null) => number | null;
  /** Which responses to retry; default 429 and 5xx. */
  isRetryable?: (res: Response) => boolean;
  /** Set when a retryable response's body is needed by getRetryDelayMs. */
  readBodyForRetry?: boolean;
};

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

function retryAfterMs(res: Response): number | null {
  const header = res.headers.get('retry-after');
  if (!header) return null;
  const seconds = Number(header);
  if (Number.isFinite(seconds)) return Math.max(0, seconds * 1000);
  const date = Date.parse(header);
  return Number.isNaN(date) ? null : Math.max(0, date - Date.now());
}

export async function fetchWithRetry(
  url: string,
  init: RequestInit,
  opts: RetryOptions = {},
): Promise<Response> {
  const {
    fetchImpl = fetch,
    maxAttempts = 5,
    baseDelayMs = 500,
    maxDelayMs = 60_000,
    getRetryDelayMs,
    isRetryable = (res) => res.status === 429 || res.status >= 500,
    readBodyForRetry = false,
  } = opts;

  let lastError: unknown;
  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    const backoff = Math.min(maxDelayMs, baseDelayMs * 2 ** (attempt - 1)) * (0.5 + Math.random());
    try {
      const res = await fetchImpl(url, init);
      if (!isRetryable(res) || attempt === maxAttempts) return res;
      const bodyText = readBodyForRetry ? await res.clone().text() : null;
      const platformDelay = getRetryDelayMs?.(res, bodyText) ?? null;
      const delay = platformDelay ?? retryAfterMs(res) ?? backoff;
      logger.warn('retrying rate-limited/failed request', {
        url,
        status: res.status,
        attempt,
        delayMs: Math.round(delay),
      });
      await sleep(delay);
    } catch (err) {
      lastError = err;
      if (attempt === maxAttempts) break;
      logger.warn('retrying failed request (network)', { url, attempt });
      await sleep(backoff);
    }
  }
  throw lastError instanceof Error
    ? lastError
    : new Error(`fetchWithRetry: exhausted ${maxAttempts} attempts for ${url}`);
}
