import { readFileSync } from 'node:fs';
import { randomUUID } from 'node:crypto';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { like } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { logger } from '@grossline/core';
import {
  clearCursors,
  closeDbPools,
  countRawShopify,
  createTenant,
  getCursor,
  listStores,
  schema,
  withTenant,
} from '@grossline/db';
import { shopifyConnector } from '../src/connectors/shopify/connector';
import { connectShopifyStore } from '../src/connectors/shopify/connect';
import { shopifyGraphQL } from '../src/connectors/shopify/client';
import { SHOP_INFO_QUERY } from '../src/connectors/shopify/queries';
import { runBackfill, runIncremental } from '../src/connectors/engine';
import type { SyncContext } from '../src/connectors/types';

process.env.SHOPIFY_BULK_POLL_MS = '1';

const fixturesDir = join(dirname(fileURLToPath(import.meta.url)), 'fixtures', 'shopify');
const fixture = (name: string) => readFileSync(join(fixturesDir, name), 'utf8');

const json = (payload: unknown) =>
  new Response(JSON.stringify(payload), {
    status: 200,
    headers: { 'content-type': 'application/json' },
  });

const SHOP_INFO = {
  data: {
    shop: {
      name: 'Demo Alpha',
      myshopifyDomain: 'demo-alpha.myshopify.com',
      ianaTimezone: 'America/New_York',
      currencyCode: 'USD',
    },
  },
};

const emptyPage = (key: string) => ({
  data: { [key]: { pageInfo: { hasNextPage: false, endCursor: null }, edges: [] } },
});

function makeRouter(): typeof fetch {
  let lastBulkStream = 'orders';
  return (async (input: unknown, init?: RequestInit) => {
    const url = String(input);
    if (url.includes('/graphql.json')) {
      const body = JSON.parse(String(init?.body)) as {
        query: string;
        variables?: Record<string, unknown>;
      };
      const q = body.query;
      if (q.includes('bulkOperationRunQuery')) {
        const inner = String(body.variables?.query ?? '');
        lastBulkStream = inner.includes('customers(')
          ? 'customers'
          : inner.includes('products(')
            ? 'products'
            : 'orders';
        return json({
          data: {
            bulkOperationRunQuery: {
              bulkOperation: { id: 'gid://shopify/BulkOperation/1', status: 'CREATED' },
              userErrors: [],
            },
          },
        });
      }
      if (q.includes('grosslineBulkPoll')) {
        return json({
          data: {
            node: {
              id: 'gid://shopify/BulkOperation/1',
              status: 'COMPLETED',
              errorCode: null,
              objectCount: '42',
              url: `https://bulk.fixtures.test/${lastBulkStream}.jsonl`,
            },
          },
        });
      }
      if (q.includes('grosslineOrdersIncremental')) {
        return json(
          JSON.parse(
            body.variables?.cursor
              ? fixture('synthetic-orders-incremental-page2.json')
              : fixture('synthetic-orders-incremental-page1.json'),
          ),
        );
      }
      if (q.includes('grosslineCustomersIncremental')) return json(emptyPage('customers'));
      if (q.includes('grosslineProductsIncremental')) return json(emptyPage('products'));
      if (q.includes('shop {')) return json(SHOP_INFO);
      return json({ errors: [{ message: `unrouted query: ${q.slice(0, 60)}` }] });
    }
    if (url.startsWith('https://bulk.fixtures.test/')) {
      const stream = url.split('/').pop()!.replace('.jsonl', '');
      return new Response(fixture(`synthetic-bulk-${stream}.jsonl`), { status: 200 });
    }
    throw new Error(`unrouted url: ${url}`);
  }) as typeof fetch;
}

const router = makeRouter();
let tenantId: string;
let connectionId: string;

const ctx = (): SyncContext => ({ tenantId, connectionId, fetchImpl: router, log: logger });

async function orderPayload(orderGidSuffix: string): Promise<Record<string, unknown>> {
  const rows = await withTenant(tenantId, (tx) =>
    tx
      .select()
      .from(schema.rawShopifyOrders)
      .where(like(schema.rawShopifyOrders.orderId, `%${orderGidSuffix}`)),
  );
  expect(rows).toHaveLength(1);
  return rows[0]!.payload as Record<string, unknown>;
}

beforeAll(async () => {
  tenantId = (
    await createTenant({
      name: 'Shopify fixture tenant',
      slug: `shopify-${randomUUID().slice(0, 8)}`,
      reportingCurrency: 'USD',
      reportingTimezone: 'America/New_York',
    })
  ).id;
  const connected = await connectShopifyStore({
    tenantId,
    shopDomain: 'demo-alpha.myshopify.com',
    accessToken: 'shpat_synthetic_test_token', // gitleaks:allow — fake token for fixtures
    fetchImpl: router,
  });
  connectionId = connected.connectionId;
});

afterAll(async () => {
  await closeDbPools();
});

describe('connect flow', () => {
  it("records the store's own timezone and currency at connect time", async () => {
    const stores = await listStores(tenantId);
    expect(stores).toHaveLength(1);
    expect(stores[0]!.storeTimezone).toBe('America/New_York');
    expect(stores[0]!.storeCurrency).toBe('USD');
  });
});

describe('shopify backfill', () => {
  it('lands orders, customers and products; a re-run writes zero duplicate rows', async () => {
    const window = {
      start: new Date('2026-01-01T00:00:00Z'),
      end: new Date('2026-03-01T00:00:00Z'),
    };
    await runBackfill(ctx(), shopifyConnector, window);
    const counts = await countRawShopify(tenantId);
    expect(counts).toEqual({ orders: 6, customers: 4, products: 3 });

    // Full re-run over the same window: identical counts, zero duplicates.
    await clearCursors(tenantId, connectionId);
    await runBackfill(ctx(), shopifyConnector, window);
    expect(await countRawShopify(tenantId)).toEqual(counts);
  });

  it('preserves edge-case payloads exactly as the platform sent them', async () => {
    const partialRefund = await orderPayload('/Order/5001003');
    const refunds = partialRefund.refunds as Record<string, unknown>[];
    expect(refunds).toHaveLength(1);
    expect(refunds[0]!.refundLineItems).toHaveLength(1);

    const multiCurrency = await orderPayload('/Order/5001004');
    expect(multiCurrency.presentmentCurrencyCode).toBe('EUR');
    const total = multiCurrency.totalPriceSet as Record<string, Record<string, string>>;
    expect(total.presentmentMoney!.currencyCode).toBe('EUR');
    expect(total.shopMoney!.currencyCode).toBe('USD');

    const cancelled = await orderPayload('/Order/5001005');
    expect(cancelled.cancelledAt).toBe('2026-02-21T10:00:00Z');
    expect(cancelled.cancelReason).toBe('CUSTOMER');

    const shippingRefundOnly = await orderPayload('/Order/5001006');
    const srRefunds = shippingRefundOnly.refunds as Record<string, unknown>[];
    expect(srRefunds[0]!.refundLineItems).toBeUndefined();

    const products = await withTenant(tenantId, (tx) =>
      tx.select().from(schema.rawShopifyProducts),
    );
    const flask = products.find((p) => p.productId.endsWith('/Product/7001003'))!;
    const flaskVariants = (flask.payload as Record<string, unknown>).variants as Record<
      string,
      unknown
    >[];
    expect((flaskVariants[0]!.inventoryItem as Record<string, unknown>).unitCost).toBeNull();

    const mug = products.find((p) => p.productId.endsWith('/Product/7001001'))!;
    const mugVariants = (mug.payload as Record<string, unknown>).variants as Record<
      string,
      unknown
    >[];
    const mugCost = mugVariants[0]!.inventoryItem as { unitCost: { amount: string } };
    expect(mugCost.unitCost.amount).toBe('6.50');
  });
});

describe('shopify incremental', () => {
  it('updates existing orders, adds new ones, and advances the watermark', async () => {
    await runIncremental(ctx(), shopifyConnector);

    const counts = await countRawShopify(tenantId);
    expect(counts.orders).toBe(7); // 6 from backfill + 1 new, updated order replaced not duplicated

    const updated = await orderPayload('/Order/5001003');
    expect((updated.refunds as unknown[]).length).toBe(2); // shipping refund added later
    expect(updated.updatedAt).toBe('2026-03-01T10:00:00Z');

    const cursor = await getCursor<{ since: string }>(tenantId, connectionId, 'incremental');
    expect(cursor?.since).toBeTruthy();
  });
});

describe('shopify throttling', () => {
  it('waits out a THROTTLED response using the cost signal, then succeeds', async () => {
    let calls = 0;
    const throttlingFetch = (async () => {
      calls++;
      if (calls === 1) {
        return json({
          errors: [{ message: 'Throttled', extensions: { code: 'THROTTLED' } }],
          extensions: {
            cost: {
              requestedQueryCost: 100,
              throttleStatus: { maximumAvailable: 1000, currentlyAvailable: 50, restoreRate: 100000 },
            },
          },
        });
      }
      return json(SHOP_INFO);
    }) as typeof fetch;

    const data = await shopifyGraphQL(
      { tenantId, connectionId, fetchImpl: throttlingFetch, log: logger },
      { shopDomain: 'demo-alpha.myshopify.com', accessToken: 'x' },
      SHOP_INFO_QUERY,
    );
    expect(calls).toBe(2);
    expect((data as typeof SHOP_INFO.data).shop.name).toBe('Demo Alpha');
  });
});
