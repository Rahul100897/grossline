// Raw Shopify landing zone. Rows are upserted on the platform's own gid so
// re-running any sync window writes zero duplicates; the payload is stored
// exactly as the platform sent it and is only ever replaced by a newer payload
// for the same gid — never edited with derived values.
import { count, sql } from 'drizzle-orm';
import { rawShopifyCustomers, rawShopifyOrders, rawShopifyProducts } from './schema';
import { withTenant } from './tenant-scope';

type OrderRow = {
  orderId: string;
  payload: Record<string, unknown>;
  orderCreatedAt: Date;
  orderUpdatedAt: Date;
};

export async function upsertRawShopifyOrders(
  tenantId: string,
  storeId: string,
  rows: OrderRow[],
): Promise<number> {
  if (rows.length === 0) return 0;
  await withTenant(tenantId, (tx) =>
    tx
      .insert(rawShopifyOrders)
      .values(rows.map((r) => ({ ...r, tenantId, storeId })))
      .onConflictDoUpdate({
        target: [rawShopifyOrders.tenantId, rawShopifyOrders.storeId, rawShopifyOrders.orderId],
        set: {
          payload: sql`excluded.payload`,
          orderUpdatedAt: sql`excluded.order_updated_at`,
          syncedAt: sql`now()`,
        },
      }),
  );
  return rows.length;
}

type CustomerRow = {
  customerId: string;
  payload: Record<string, unknown>;
  customerUpdatedAt: Date | null;
};

export async function upsertRawShopifyCustomers(
  tenantId: string,
  storeId: string,
  rows: CustomerRow[],
): Promise<number> {
  if (rows.length === 0) return 0;
  await withTenant(tenantId, (tx) =>
    tx
      .insert(rawShopifyCustomers)
      .values(rows.map((r) => ({ ...r, tenantId, storeId })))
      .onConflictDoUpdate({
        target: [
          rawShopifyCustomers.tenantId,
          rawShopifyCustomers.storeId,
          rawShopifyCustomers.customerId,
        ],
        set: {
          payload: sql`excluded.payload`,
          customerUpdatedAt: sql`excluded.customer_updated_at`,
          syncedAt: sql`now()`,
        },
      }),
  );
  return rows.length;
}

type ProductRow = {
  productId: string;
  payload: Record<string, unknown>;
  productUpdatedAt: Date | null;
};

export async function upsertRawShopifyProducts(
  tenantId: string,
  storeId: string,
  rows: ProductRow[],
): Promise<number> {
  if (rows.length === 0) return 0;
  await withTenant(tenantId, (tx) =>
    tx
      .insert(rawShopifyProducts)
      .values(rows.map((r) => ({ ...r, tenantId, storeId })))
      .onConflictDoUpdate({
        target: [
          rawShopifyProducts.tenantId,
          rawShopifyProducts.storeId,
          rawShopifyProducts.productId,
        ],
        set: {
          payload: sql`excluded.payload`,
          productUpdatedAt: sql`excluded.product_updated_at`,
          syncedAt: sql`now()`,
        },
      }),
  );
  return rows.length;
}

export async function countRawShopify(
  tenantId: string,
): Promise<{ orders: number; customers: number; products: number }> {
  return withTenant(tenantId, async (tx) => {
    const [o] = await tx.select({ n: count() }).from(rawShopifyOrders);
    const [c] = await tx.select({ n: count() }).from(rawShopifyCustomers);
    const [p] = await tx.select({ n: count() }).from(rawShopifyProducts);
    return { orders: o?.n ?? 0, customers: c?.n ?? 0, products: p?.n ?? 0 };
  });
}
