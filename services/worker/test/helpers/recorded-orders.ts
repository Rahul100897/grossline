// Loads the REAL recorded order fixtures into a test tenant, producing the
// exact payload shape the connector persists (bulk reassembly + per-order
// refund enrichment).
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { upsertRawShopifyOrders } from '@grossline/db';
import { reassembleJsonl } from '../../src/connectors/shopify/bulk';
import { flattenConnections } from '../../src/connectors/shopify/client';

const fixturesDir = join(dirname(fileURLToPath(import.meta.url)), '..', 'fixtures', 'shopify');
const fixture = (name: string) => readFileSync(join(fixturesDir, name), 'utf8');

export async function loadRecordedOrders(tenantId: string, storeId: string): Promise<number> {
  const roots = reassembleJsonl(
    fixture('recorded-bulk-orders.jsonl')
      .split('\n')
      .filter((l) => l.trim().length > 0),
  );
  const refundsMap = JSON.parse(fixture('recorded-order-refunds.json')) as Record<
    string,
    { refunds: unknown[] } | string
  >;
  const orders = roots.filter(
    (r) => typeof r.id === 'string' && (r.id as string).includes('/Order/'),
  );
  for (const order of orders) {
    const enrichment = refundsMap[order.id as string];
    if (enrichment && typeof enrichment !== 'string') {
      order.refunds = flattenConnections(enrichment.refunds) as unknown[];
    }
  }
  return upsertRawShopifyOrders(
    tenantId,
    storeId,
    orders.map((o) => ({
      orderId: o.id as string,
      payload: o,
      orderCreatedAt: new Date(o.createdAt as string),
      orderUpdatedAt: new Date(o.updatedAt as string),
    })),
  );
}
