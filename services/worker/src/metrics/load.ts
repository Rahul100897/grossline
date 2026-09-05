import { and, sql } from 'drizzle-orm';
import { orderFactsFromPayload, type OrderFacts } from '@grossline/core';
import { schema, withTenant } from '@grossline/db';

/**
 * Order facts for a UTC window, keyed by processedAt (docs/metrics.md: the
 * order date is processedAt, everywhere). Returns the raw watermark — the
 * newest synced_at among the rows the numbers were computed from.
 */
export async function loadOrderFactsForWindow(
  tenantId: string,
  window: { startUtc: Date; endUtc: Date },
): Promise<{ facts: OrderFacts[]; watermark: Date | null }> {
  const rows = await withTenant(tenantId, (tx) =>
    tx
      .select({ payload: schema.rawShopifyOrders.payload, syncedAt: schema.rawShopifyOrders.syncedAt })
      .from(schema.rawShopifyOrders)
      .where(
        and(
          sql`(${schema.rawShopifyOrders.payload}->>'processedAt')::timestamptz >= ${window.startUtc}`,
          sql`(${schema.rawShopifyOrders.payload}->>'processedAt')::timestamptz < ${window.endUtc}`,
        ),
      ),
  );
  let watermark: Date | null = null;
  const facts = rows.map((row) => {
    if (!watermark || row.syncedAt > watermark) watermark = row.syncedAt;
    return orderFactsFromPayload(row.payload);
  });
  return { facts, watermark };
}
