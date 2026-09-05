import { describe, expect, it } from 'vitest';
import { fetchWithRetry } from '../src/connectors/http';

function fetchSequence(responses: (Response | Error)[]): { impl: typeof fetch; calls: () => number } {
  let i = 0;
  const impl = (async () => {
    const next = responses[Math.min(i, responses.length - 1)]!;
    i++;
    if (next instanceof Error) throw next;
    return next.clone();
  }) as typeof fetch;
  return { impl, calls: () => i };
}

describe('fetchWithRetry', () => {
  it('retries 429s honoring Retry-After and eventually succeeds', async () => {
    const { impl, calls } = fetchSequence([
      new Response('slow down', { status: 429, headers: { 'retry-after': '0' } }),
      new Response('slow down', { status: 429, headers: { 'retry-after': '0' } }),
      new Response('ok', { status: 200 }),
    ]);
    const res = await fetchWithRetry('https://example.test/x', {}, { fetchImpl: impl, baseDelayMs: 1 });
    expect(res.status).toBe(200);
    expect(calls()).toBe(3);
  });

  it('prefers the platform-specific delay extractor over headers', async () => {
    let sawExtractor = false;
    const { impl } = fetchSequence([
      new Response('{"throttled":true}', { status: 429, headers: { 'retry-after': '9999' } }),
      new Response('ok', { status: 200 }),
    ]);
    const started = Date.now();
    const res = await fetchWithRetry(
      'https://example.test/x',
      {},
      {
        fetchImpl: impl,
        baseDelayMs: 1,
        readBodyForRetry: true,
        getRetryDelayMs: (_res, body) => {
          sawExtractor = body !== null && body.includes('throttled');
          return 1; // platform says: 1ms, overriding the huge Retry-After
        },
      },
    );
    expect(res.status).toBe(200);
    expect(sawExtractor).toBe(true);
    expect(Date.now() - started).toBeLessThan(5000);
  });

  it('retries network errors and gives up after maxAttempts', async () => {
    const { impl, calls } = fetchSequence([new Error('ECONNRESET')]);
    await expect(
      fetchWithRetry('https://example.test/x', {}, { fetchImpl: impl, maxAttempts: 3, baseDelayMs: 1 }),
    ).rejects.toThrow(/ECONNRESET/);
    expect(calls()).toBe(3);
  });

  it('does not retry non-retryable statuses', async () => {
    const { impl, calls } = fetchSequence([new Response('nope', { status: 403 })]);
    const res = await fetchWithRetry('https://example.test/x', {}, { fetchImpl: impl });
    expect(res.status).toBe(403);
    expect(calls()).toBe(1);
  });
});
