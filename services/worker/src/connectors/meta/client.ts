import { z } from 'zod';
import { fetchWithRetry } from '../http';
import type { SyncContext } from '../types';

export const metaCredentialsSchema = z.object({
  adAccountId: z.string().regex(/^act_\d+$/),
  accessToken: z.string().min(1),
});
export type MetaCredentials = z.infer<typeof metaCredentialsSchema>;

export function metaApiVersion(): string {
  return process.env.META_API_VERSION || 'v21.0';
}

export function metaBaseUrl(): string {
  return `https://graph.facebook.com/${metaApiVersion()}`;
}

const errorEnvelope = z.object({
  error: z
    .object({
      message: z.string(),
      code: z.number().optional(),
      error_subcode: z.number().optional(),
      type: z.string().optional(),
    })
    .passthrough(),
});

/** Meta's rate-limit error codes (API Throttling / BUC limits). */
const RATE_LIMIT_CODES = new Set([4, 17, 32, 613, 80000, 80004]);

const usageHeaderSchema = z.record(
  z.string(),
  z.array(z.object({ estimated_time_to_regain_access: z.number().optional() }).passthrough()),
);

/** Minutes until access returns, as Meta reports it — the platform's own signal. */
function regainAccessMs(res: Response): number | null {
  const header = res.headers.get('x-business-use-case-usage');
  if (!header) return null;
  try {
    const usage = usageHeaderSchema.parse(JSON.parse(header));
    let maxMinutes = 0;
    for (const entries of Object.values(usage)) {
      for (const entry of entries) {
        maxMinutes = Math.max(maxMinutes, entry.estimated_time_to_regain_access ?? 0);
      }
    }
    return maxMinutes > 0 ? maxMinutes * 60_000 : null;
  } catch {
    return null;
  }
}

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

/**
 * GET against the Marketing API. Meta signals throttling with HTTP 400 plus a
 * rate-limit error code and the X-Business-Use-Case-Usage header — honoured
 * here; transport-level 429/5xx are handled by fetchWithRetry.
 */
export async function metaGet(
  ctx: SyncContext,
  creds: MetaCredentials,
  pathOrUrl: string,
  params?: Record<string, string>,
): Promise<unknown> {
  const url = pathOrUrl.startsWith('https://')
    ? new URL(pathOrUrl) // paging.next URLs come back absolute and signed
    : new URL(`${metaBaseUrl()}/${pathOrUrl.replace(/^\//, '')}`);
  for (const [k, v] of Object.entries(params ?? {})) url.searchParams.set(k, v);
  if (!url.searchParams.has('access_token')) {
    url.searchParams.set('access_token', creds.accessToken);
  }

  const maxAttempts = 5;
  const backoffBaseMs = Number(process.env.META_BACKOFF_MS ?? 5000);
  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    const res = await fetchWithRetry(url.toString(), { method: 'GET' }, { fetchImpl: ctx.fetchImpl });
    const body: unknown = await res.json();
    if (res.ok) return body;

    const parsed = errorEnvelope.safeParse(body);
    const code = parsed.success ? (parsed.data.error.code ?? -1) : -1;
    if (RATE_LIMIT_CODES.has(code) && attempt < maxAttempts) {
      const waitMs = regainAccessMs(res) ?? backoffBaseMs * 2 ** (attempt - 1);
      ctx.log.warn('meta rate limited, backing off', { code, waitMs, attempt });
      await sleep(waitMs);
      continue;
    }
    const message = parsed.success ? parsed.data.error.message : `HTTP ${res.status}`;
    throw new Error(`meta api error (code ${code}): ${message}`);
  }
  throw new Error('meta api: still rate limited after retries');
}

const insightsPageSchema = z.object({
  data: z.array(z.record(z.string(), z.unknown())),
  paging: z.object({ next: z.string().optional() }).passthrough().optional(),
});

/** Fetch every page of an insights query. */
export async function metaGetAllPages(
  ctx: SyncContext,
  creds: MetaCredentials,
  path: string,
  params: Record<string, string>,
): Promise<Record<string, unknown>[]> {
  const rows: Record<string, unknown>[] = [];
  let page = insightsPageSchema.parse(await metaGet(ctx, creds, path, params));
  rows.push(...page.data);
  while (page.paging?.next) {
    page = insightsPageSchema.parse(await metaGet(ctx, creds, page.paging.next));
    rows.push(...page.data);
  }
  return rows;
}
