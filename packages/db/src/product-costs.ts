import { and, asc, gte, lt, sql } from 'drizzle-orm';
import { z } from 'zod';
import {
  decimalToMinorUnits,
  type OrderLineForCosting,
  type ProductCostRow,
} from '@grossline/core';
import { productCosts, rawShopifyOrders, rawShopifyProducts } from './schema';
import { withTenant } from './tenant-scope';

const costInputSchema = z
  .object({
    sku: z.string().optional(),
    variantId: z.string().optional(),
    unitCostMinor: z.number().int().nonnegative(),
    currency: z.string().length(3),
    effectiveFrom: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
    source: z.enum(['shopify', 'upload']),
  })
  .refine((r) => (r.sku ?? '') !== '' || (r.variantId ?? '') !== '', {
    message: 'a cost row needs a sku or a variantId',
  });

export type ProductCostInput = z.input<typeof costInputSchema>;

/** Upsert on (sku, variantId, effectiveFrom): re-uploading a key replaces it. */
export async function upsertProductCosts(
  tenantId: string,
  rows: ProductCostInput[],
): Promise<number> {
  if (rows.length === 0) return 0;
  const parsed = rows.map((r) => costInputSchema.parse(r));
  await withTenant(tenantId, (tx) =>
    tx
      .insert(productCosts)
      .values(
        parsed.map((r) => ({
          tenantId,
          sku: r.sku ?? '',
          variantId: r.variantId ?? '',
          unitCostMinor: r.unitCostMinor,
          currency: r.currency.toUpperCase(),
          effectiveFrom: r.effectiveFrom,
          source: r.source,
        })),
      )
      .onConflictDoUpdate({
        target: [
          productCosts.tenantId,
          productCosts.sku,
          productCosts.variantId,
          productCosts.effectiveFrom,
        ],
        set: {
          unitCostMinor: sql`excluded.unit_cost_minor`,
          currency: sql`excluded.currency`,
          source: sql`excluded.source`,
          uploadedAt: sql`now()`,
        },
      }),
  );
  return parsed.length;
}

export async function listProductCosts(tenantId: string): Promise<ProductCostRow[]> {
  const rows = await withTenant(tenantId, (tx) =>
    tx.select().from(productCosts).orderBy(asc(productCosts.effectiveFrom)),
  );
  return rows.map((r) => ({
    sku: r.sku,
    variantId: r.variantId,
    unitCostMinor: r.unitCostMinor,
    currency: r.currency,
    effectiveFrom: r.effectiveFrom,
    source: r.source,
  }));
}

const lineItemSchema = z
  .object({
    sku: z.string().nullish(),
    quantity: z.number().int(),
    variant: z.object({ id: z.string() }).nullish(),
    discountedUnitPriceSet: z
      .object({ shopMoney: z.object({ amount: z.string(), currencyCode: z.string() }) })
      .optional(),
  })
  .passthrough();

const orderPayloadSchema = z
  .object({
    id: z.string(),
    cancelledAt: z.string().nullish(),
    lineItems: z.array(z.record(z.string(), z.unknown())).optional(),
  })
  .passthrough();

/**
 * Order lines needing costs in [start, end) by order creation time. Cancelled
 * orders are excluded entirely (docs/metrics.md). Revenue is the discounted
 * line total in the shop's own currency, integer minor units.
 */
export async function listCostableOrderLines(
  tenantId: string,
  window: { start: Date; end: Date },
): Promise<OrderLineForCosting[]> {
  const orders = await withTenant(tenantId, (tx) =>
    tx
      .select({ payload: rawShopifyOrders.payload, createdAt: rawShopifyOrders.orderCreatedAt })
      .from(rawShopifyOrders)
      .where(
        and(
          gte(rawShopifyOrders.orderCreatedAt, window.start),
          lt(rawShopifyOrders.orderCreatedAt, window.end),
        ),
      ),
  );
  const lines: OrderLineForCosting[] = [];
  for (const order of orders) {
    const payload = orderPayloadSchema.parse(order.payload);
    if (payload.cancelledAt) continue;
    for (const raw of payload.lineItems ?? []) {
      const item = lineItemSchema.parse(raw);
      const money = item.discountedUnitPriceSet?.shopMoney;
      const unitMinor = money ? decimalToMinorUnits(money.amount, money.currencyCode) : 0;
      lines.push({
        orderId: payload.id,
        orderDate: order.createdAt.toISOString().slice(0, 10),
        sku: item.sku ?? null,
        variantId: item.variant?.id ?? null,
        quantity: item.quantity,
        lineRevenueMinor: unitMinor * item.quantity,
        currency: money?.currencyCode ?? 'USD',
      });
    }
  }
  return lines;
}

const variantSchema = z
  .object({
    id: z.string(),
    sku: z.string().nullish(),
    inventoryItem: z
      .object({
        unitCost: z.object({ amount: z.string(), currencyCode: z.string() }).nullish(),
      })
      .nullish(),
  })
  .passthrough();

const productPayloadSchema = z
  .object({ variants: z.array(z.record(z.string(), z.unknown())).optional() })
  .passthrough();

/** Applies from the beginning of time so already-synced history resolves. */
const INITIAL_EFFECTIVE_FROM = '1970-01-01';

/**
 * Seed/refresh costs from Shopify's inventoryItem.unitCost (raw products).
 * First sighting of a variant → effective from 1970-01-01; a *changed* cost →
 * a new row effective today, so historical months never move.
 */
export async function importShopifyCosts(
  tenantId: string,
  today: string = new Date().toISOString().slice(0, 10),
): Promise<{ inserted: number; unchanged: number }> {
  const products = await withTenant(tenantId, (tx) =>
    tx.select({ payload: rawShopifyProducts.payload }).from(rawShopifyProducts),
  );
  const existing = await listProductCosts(tenantId);

  let inserted = 0;
  let unchanged = 0;
  const toUpsert: ProductCostInput[] = [];

  for (const product of products) {
    const payload = productPayloadSchema.parse(product.payload);
    for (const rawVariant of payload.variants ?? []) {
      const variant = variantSchema.parse(rawVariant);
      const unitCost = variant.inventoryItem?.unitCost;
      if (!unitCost) continue; // merchant does not maintain a cost — stays missing
      const sku = variant.sku ?? '';
      const unitCostMinor = decimalToMinorUnits(unitCost.amount, unitCost.currencyCode);

      const history = existing
        .filter((r) => r.variantId === variant.id)
        .sort((a, b) => (a.effectiveFrom < b.effectiveFrom ? -1 : 1));
      const latest = history.at(-1);

      if (!latest) {
        toUpsert.push({
          sku,
          variantId: variant.id,
          unitCostMinor,
          currency: unitCost.currencyCode,
          effectiveFrom: INITIAL_EFFECTIVE_FROM,
          source: 'shopify',
        });
        inserted++;
      } else if (latest.unitCostMinor !== unitCostMinor || latest.currency !== unitCost.currencyCode) {
        toUpsert.push({
          sku,
          variantId: variant.id,
          unitCostMinor,
          currency: unitCost.currencyCode,
          effectiveFrom: today,
          source: 'shopify',
        });
        inserted++;
      } else {
        unchanged++;
      }
    }
  }
  await upsertProductCosts(tenantId, toUpsert);
  return { inserted, unchanged };
}
