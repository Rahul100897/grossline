import { z } from 'zod';
import { fetchWithRetry } from '../http';
import type { SyncContext } from '../types';

export const shopifyCredentialsSchema = z.object({
  shopDomain: z.string().min(1),
  accessToken: z.string().min(1),
});
export type ShopifyCredentials = z.infer<typeof shopifyCredentialsSchema>;

const graphqlEnvelope = z.object({
  data: z.unknown().optional(),
  errors: z
    .array(
      z.object({
        message: z.string(),
        extensions: z.object({ code: z.string().optional() }).passthrough().optional(),
      }),
    )
    .optional(),
  extensions: z
    .object({
      cost: z
        .object({
          requestedQueryCost: z.number(),
          throttleStatus: z.object({
            maximumAvailable: z.number(),
            currentlyAvailable: z.number(),
            restoreRate: z.number(),
          }),
        })
        .optional(),
    })
    .optional(),
});

export function shopifyApiVersion(): string {
  return process.env.SHOPIFY_API_VERSION || '2026-07';
}

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

/**
 * One GraphQL call against a store's Admin API. Handles Shopify's cost-based
 * throttling from the response itself (THROTTLED errors carry throttleStatus,
 * which says exactly how long until enough budget restores — no fixed sleeps);
 * transport-level 429/5xx are handled by fetchWithRetry.
 */
export async function shopifyGraphQL(
  ctx: SyncContext,
  creds: ShopifyCredentials,
  query: string,
  variables?: Record<string, unknown>,
): Promise<unknown> {
  const url = `https://${creds.shopDomain}/admin/api/${shopifyApiVersion()}/graphql.json`;
  const maxAttempts = 6;
  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    const res = await fetchWithRetry(
      url,
      {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          'x-shopify-access-token': creds.accessToken,
        },
        body: JSON.stringify({ query, variables }),
      },
      { fetchImpl: ctx.fetchImpl },
    );
    if (!res.ok) {
      throw new Error(`shopify graphql: HTTP ${res.status} from ${creds.shopDomain}`);
    }
    const envelope = graphqlEnvelope.parse(await res.json());
    const throttled = envelope.errors?.some((e) => e.extensions?.code === 'THROTTLED') ?? false;
    if (throttled && attempt < maxAttempts) {
      const cost = envelope.extensions?.cost;
      const deficit = cost
        ? Math.max(0, cost.requestedQueryCost - cost.throttleStatus.currentlyAvailable)
        : 0;
      const restoreRate = cost?.throttleStatus.restoreRate ?? 50;
      const waitMs = cost ? Math.ceil((deficit / restoreRate) * 1000) : 1000;
      ctx.log.warn('shopify throttled, waiting for cost budget', { waitMs, attempt });
      await sleep(waitMs);
      continue;
    }
    if (envelope.errors && envelope.errors.length > 0) {
      throw new Error(`shopify graphql errors: ${envelope.errors.map((e) => e.message).join('; ')}`);
    }
    return envelope.data;
  }
  throw new Error('shopify graphql: still throttled after retries');
}

/**
 * Replace GraphQL connection wrappers ({ edges: [{ node }] }) with plain
 * arrays, recursively, so paginated payloads match the shape bulk-operation
 * reassembly produces. Purely structural — no values are touched.
 */
export function flattenConnections(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(flattenConnections);
  if (value === null || typeof value !== 'object') return value;
  const obj = value as Record<string, unknown>;
  const edges = obj.edges;
  if (
    Array.isArray(edges) &&
    Object.keys(obj).every((k) => ['edges', 'pageInfo', 'nodes'].includes(k))
  ) {
    return edges.map((e) => flattenConnections((e as Record<string, unknown>).node));
  }
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(obj)) out[k] = flattenConnections(v);
  return out;
}
