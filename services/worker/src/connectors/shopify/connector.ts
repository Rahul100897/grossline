import { z } from 'zod';
import {
  getConnection,
  getCredential,
  upsertRawShopifyCustomers,
  upsertRawShopifyOrders,
  upsertRawShopifyProducts,
} from '@grossline/db';
import type { Connector, DateWindow, SyncContext } from '../types';
import { flattenConnections, shopifyGraphQL, shopifyCredentialsSchema } from './client';
import type { ShopifyCredentials } from './client';
import { reassembleJsonl, runBulkQuery } from './bulk';
import {
  SHOP_INFO_QUERY,
  customersBulkQuery,
  customersIncrementalQuery,
  ordersBulkQuery,
  ordersIncrementalQuery,
  productsBulkQuery,
  productsIncrementalQuery,
} from './queries';

type LoadedContext = { creds: ShopifyCredentials; storeId: string };

async function loadShopifyContext(ctx: SyncContext): Promise<LoadedContext> {
  const connection = await getConnection(ctx.tenantId, ctx.connectionId);
  if (!connection) throw new Error('connection not found');
  if (!connection.storeId) throw new Error('shopify connection has no store');
  if (!connection.credentialRef) throw new Error('shopify connection has no credential');
  const credential = await getCredential(ctx.tenantId, connection.credentialRef);
  if (!credential) throw new Error('shopify credential not found');
  return { creds: shopifyCredentialsSchema.parse(credential.payload), storeId: connection.storeId };
}

const nodeWithDates = z
  .object({ id: z.string(), createdAt: z.string().optional(), updatedAt: z.string().optional() })
  .passthrough();

function toOrderRows(roots: Record<string, unknown>[]) {
  return roots
    .filter((r) => typeof r.id === 'string' && (r.id as string).includes('/Order/'))
    .map((r) => {
      const node = nodeWithDates.parse(r);
      if (!node.createdAt || !node.updatedAt) throw new Error(`order ${node.id} missing timestamps`);
      return {
        orderId: node.id,
        payload: r,
        orderCreatedAt: new Date(node.createdAt),
        orderUpdatedAt: new Date(node.updatedAt),
      };
    });
}

function toCustomerRows(roots: Record<string, unknown>[]) {
  return roots
    .filter((r) => typeof r.id === 'string' && (r.id as string).includes('/Customer/'))
    .map((r) => {
      const node = nodeWithDates.parse(r);
      return {
        customerId: node.id,
        payload: r,
        customerUpdatedAt: node.updatedAt ? new Date(node.updatedAt) : null,
      };
    });
}

function toProductRows(roots: Record<string, unknown>[]) {
  return roots
    .filter((r) => typeof r.id === 'string' && (r.id as string).includes('/Product/'))
    .map((r) => {
      const node = nodeWithDates.parse(r);
      return {
        productId: node.id,
        payload: r,
        productUpdatedAt: node.updatedAt ? new Date(node.updatedAt) : null,
      };
    });
}

function bulkQueryFor(stream: string, window: DateWindow): string {
  switch (stream) {
    case 'orders':
      return ordersBulkQuery(window.start, window.end);
    case 'customers':
      return customersBulkQuery(window.start, window.end);
    case 'products':
      return productsBulkQuery(window.start, window.end);
    default:
      throw new Error(`unknown shopify stream ${stream}`);
  }
}

async function persistStream(
  ctx: SyncContext,
  storeId: string,
  stream: string,
  roots: Record<string, unknown>[],
): Promise<number> {
  switch (stream) {
    case 'orders':
      return upsertRawShopifyOrders(ctx.tenantId, storeId, toOrderRows(roots));
    case 'customers':
      return upsertRawShopifyCustomers(ctx.tenantId, storeId, toCustomerRows(roots));
    case 'products':
      return upsertRawShopifyProducts(ctx.tenantId, storeId, toProductRows(roots));
    default:
      throw new Error(`unknown shopify stream ${stream}`);
  }
}

const pageSchema = z.object({
  pageInfo: z.object({ hasNextPage: z.boolean(), endCursor: z.string().nullable() }),
  edges: z.array(z.object({ node: z.record(z.string(), z.unknown()) })),
});

async function pullIncrementalStream(
  ctx: SyncContext,
  creds: ShopifyCredentials,
  storeId: string,
  stream: string,
  since: string,
): Promise<number> {
  const query =
    stream === 'orders'
      ? ordersIncrementalQuery()
      : stream === 'customers'
        ? customersIncrementalQuery()
        : productsIncrementalQuery();
  const search = `updated_at:>='${since}'`;
  let cursor: string | null = null;
  let written = 0;
  for (;;) {
    const data = z
      .record(z.string(), z.unknown())
      .parse(await shopifyGraphQL(ctx, creds, query, { cursor, search }));
    const connectionData = pageSchema.parse(data[stream]);
    const roots = connectionData.edges.map(
      (e) => flattenConnections(e.node) as Record<string, unknown>,
    );
    written += await persistStream(ctx, storeId, stream, roots);
    if (!connectionData.pageInfo.hasNextPage || !connectionData.pageInfo.endCursor) break;
    cursor = connectionData.pageInfo.endCursor;
  }
  return written;
}

const STREAMS = ['orders', 'customers', 'products'];
/** Overlap subtracted from the next watermark so clock skew never loses rows. */
const INCREMENTAL_OVERLAP_MS = 5 * 60_000;

export const shopifyConnector: Connector = {
  provider: 'shopify',
  streams: STREAMS,
  chunkDays: 30,

  async backfillChunk(ctx, stream, window) {
    const { creds, storeId } = await loadShopifyContext(ctx);
    const lines = await runBulkQuery(ctx, creds, bulkQueryFor(stream, window));
    const roots = reassembleJsonl(lines);
    const rowsWritten = await persistStream(ctx, storeId, stream, roots);
    ctx.log.info('shopify backfill chunk done', {
      stream,
      start: window.start.toISOString(),
      end: window.end.toISOString(),
      rowsWritten,
    });
    return { rowsWritten };
  },

  async incremental(ctx, since) {
    const { creds, storeId } = await loadShopifyContext(ctx);
    const startedAt = Date.now();
    // First incremental without a watermark covers the last 2 days.
    const effectiveSince = since ?? new Date(startedAt - 2 * 86_400_000).toISOString();
    let rowsWritten = 0;
    for (const stream of STREAMS) {
      rowsWritten += await pullIncrementalStream(ctx, creds, storeId, stream, effectiveSince);
    }
    return {
      rowsWritten,
      newSince: new Date(startedAt - INCREMENTAL_OVERLAP_MS).toISOString(),
    };
  },

  async health(ctx) {
    try {
      const { creds } = await loadShopifyContext(ctx);
      await shopifyGraphQL(ctx, creds, SHOP_INFO_QUERY);
      return { healthy: true };
    } catch (err) {
      return { healthy: false, detail: err instanceof Error ? err.message : String(err) };
    }
  },
};
