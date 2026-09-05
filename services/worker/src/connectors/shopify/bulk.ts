import { z } from 'zod';
import { fetchWithRetry } from '../http';
import type { SyncContext } from '../types';
import { shopifyGraphQL, type ShopifyCredentials } from './client';

const runResultSchema = z.object({
  bulkOperationRunQuery: z.object({
    bulkOperation: z.object({ id: z.string(), status: z.string() }).nullable(),
    userErrors: z.array(z.object({ field: z.unknown(), message: z.string() })),
  }),
});

const pollResultSchema = z.object({
  node: z
    .object({
      id: z.string(),
      status: z.string(),
      errorCode: z.string().nullable().optional(),
      objectCount: z.union([z.string(), z.number()]).optional(),
      url: z.string().nullable().optional(),
    })
    .nullable(),
});

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

/**
 * Run a bulk operation query and return the resulting JSONL lines.
 * Shopify allows one bulk operation at a time per shop; the engine runs
 * streams sequentially so that constraint holds.
 */
export async function runBulkQuery(
  ctx: SyncContext,
  creds: ShopifyCredentials,
  innerQuery: string,
): Promise<string[]> {
  const started = runResultSchema.parse(
    await shopifyGraphQL(
      ctx,
      creds,
      `mutation grosslineBulk($query: String!) {
        bulkOperationRunQuery(query: $query) {
          bulkOperation { id status }
          userErrors { field message }
        }
      }`,
      { query: innerQuery },
    ),
  );
  const { bulkOperation, userErrors } = started.bulkOperationRunQuery;
  if (userErrors.length > 0 || !bulkOperation) {
    throw new Error(
      `shopify bulk run rejected: ${userErrors.map((e) => e.message).join('; ') || 'no operation'}`,
    );
  }

  const pollIntervalMs = Number(process.env.SHOPIFY_BULK_POLL_MS ?? 2000);
  const timeoutMs = Number(process.env.SHOPIFY_BULK_TIMEOUT_MS ?? 30 * 60_000);
  const deadline = Date.now() + timeoutMs;

  for (;;) {
    const polled = pollResultSchema.parse(
      await shopifyGraphQL(
        ctx,
        creds,
        `query grosslineBulkPoll($id: ID!) {
          node(id: $id) {
            ... on BulkOperation { id status errorCode objectCount url }
          }
        }`,
        { id: bulkOperation.id },
      ),
    );
    const op = polled.node;
    if (!op) throw new Error('shopify bulk poll: operation vanished');
    if (op.status === 'COMPLETED') {
      if (!op.url) return []; // zero objects
      const res = await fetchWithRetry(op.url, { method: 'GET' }, { fetchImpl: ctx.fetchImpl });
      if (!res.ok) throw new Error(`shopify bulk download: HTTP ${res.status}`);
      const text = await res.text();
      return text.split('\n').filter((line) => line.trim().length > 0);
    }
    if (op.status === 'FAILED' || op.status === 'CANCELED' || op.status === 'EXPIRED') {
      throw new Error(`shopify bulk operation ${op.status}: ${op.errorCode ?? 'unknown error'}`);
    }
    if (Date.now() > deadline) throw new Error('shopify bulk operation timed out');
    await sleep(pollIntervalMs);
  }
}

const GID_TYPE = /^gid:\/\/shopify\/(\w+)\//;

const CHILD_KEYS: Record<string, string> = {
  LineItem: 'lineItems',
  RefundLineItem: 'refundLineItems',
  ProductVariant: 'variants',
  Refund: 'refunds',
  Fulfillment: 'fulfillments',
};

function childKeyFor(gid: string): string {
  const match = GID_TYPE.exec(gid);
  const type = match?.[1] ?? 'child';
  return CHILD_KEYS[type] ?? `${type.charAt(0).toLowerCase()}${type.slice(1)}s`;
}

/** Register every nested object carrying a gid so children can attach to it. */
function registerGids(value: unknown, byGid: Map<string, Record<string, unknown>>): void {
  if (Array.isArray(value)) {
    for (const item of value) registerGids(item, byGid);
    return;
  }
  if (value === null || typeof value !== 'object') return;
  const obj = value as Record<string, unknown>;
  if (typeof obj.id === 'string' && obj.id.startsWith('gid://')) byGid.set(obj.id, obj);
  for (const v of Object.values(obj)) registerGids(v, byGid);
}

/**
 * Reassemble bulk-operation JSONL into nested objects. Bulk ops flatten every
 * connection into standalone lines whose __parentId points at the parent
 * object (which may itself be nested, e.g. a refund inside an order).
 */
export function reassembleJsonl(lines: string[]): Record<string, unknown>[] {
  const roots: Record<string, unknown>[] = [];
  const byGid = new Map<string, Record<string, unknown>>();

  for (const line of lines) {
    const obj = JSON.parse(line) as Record<string, unknown>;
    const parentId = obj.__parentId as string | undefined;
    if (parentId === undefined) {
      roots.push(obj);
      registerGids(obj, byGid);
      continue;
    }
    delete obj.__parentId;
    const parent = byGid.get(parentId);
    if (!parent) {
      // Orphaned child: parent line missing from the export. Keep it visible.
      roots.push({ __orphaned: true, __parentId: parentId, ...obj });
      continue;
    }
    const key = childKeyFor((obj.id as string) ?? '');
    const bucket = (parent[key] ??= []) as unknown[];
    bucket.push(obj);
    registerGids(obj, byGid);
  }
  return roots;
}
