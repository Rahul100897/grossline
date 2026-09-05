import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { closeDbPools } from '../src/client';
import {
  countRawGoogleAdsInsights,
  countRawMetaInsights,
} from '../src/index';
import { countRawShopify } from '../src/raw-shopify';
import { schema } from '../src/index';
import { withTenant } from '../src/tenant-scope';
import { seedDemoTenant, type SeedSummary } from '../src/seed-demo';

const FIXED_NOW = new Date('2026-09-05T12:00:00Z');
let summary: SeedSummary;
let orders: { payload: Record<string, unknown>; orderCreatedAt: Date }[];

type OrderPayload = {
  cancelledAt: string | null;
  totalDiscountsSet: { shopMoney: { amount: string } };
  lineItems: { sku: string }[];
  refunds: unknown[];
};

beforeAll(async () => {
  summary = await seedDemoTenant(FIXED_NOW);
  orders = (
    await withTenant(summary.tenantId, (tx) => tx.select().from(schema.rawShopifyOrders))
  ).map((r) => ({ payload: r.payload as Record<string, unknown>, orderCreatedAt: r.orderCreatedAt }));
}, 120_000);

afterAll(async () => {
  await closeDbPools();
});

const inMonth = (d: Date, year: number, month: number) =>
  d.getUTCFullYear() === year && d.getUTCMonth() + 1 === month;

describe('seed:demo', () => {
  it('creates a believable volume of data across 18 months', () => {
    expect(summary.months).toBe(18);
    expect(summary.orders).toBeGreaterThan(1500);
    expect(summary.customers).toBeGreaterThan(500);
    expect(summary.metaRows).toBeGreaterThan(1500);
    expect(summary.googleRows).toBeGreaterThan(1000);
  });

  it('re-running the seed writes zero duplicate rows', async () => {
    const before = {
      shopify: await countRawShopify(summary.tenantId),
      meta: await countRawMetaInsights(summary.tenantId),
      google: await countRawGoogleAdsInsights(summary.tenantId),
    };
    await seedDemoTenant(FIXED_NOW);
    expect(await countRawShopify(summary.tenantId)).toEqual(before.shopify);
    expect(await countRawMetaInsights(summary.tenantId)).toBe(before.meta);
    expect(await countRawGoogleAdsInsights(summary.tenantId)).toBe(before.google);
  }, 120_000);

  it('has a Q4 spike', () => {
    const november = orders.filter((o) => inMonth(o.orderCreatedAt, 2025, 11)).length;
    const september = orders.filter((o) => inMonth(o.orderCreatedAt, 2025, 9)).length;
    expect(november).toBeGreaterThan(september * 1.4);
  });

  it('has a discount-heavy month', () => {
    const may = orders.filter((o) => inMonth(o.orderCreatedAt, 2025, 5));
    const discounted = may.filter(
      (o) => Number((o.payload as unknown as OrderPayload).totalDiscountsSet.shopMoney.amount) > 0,
    );
    expect(discounted.length / may.length).toBeGreaterThan(0.5);
  });

  it('has a stockout period for the mug', () => {
    const stockoutWindow = orders.filter((o) => {
      const d = o.orderCreatedAt;
      return inMonth(d, 2025, 10) && d.getUTCDate() >= 5 && d.getUTCDate() <= 25;
    });
    expect(stockoutWindow.length).toBeGreaterThan(0);
    const withMug = stockoutWindow.filter((o) =>
      (o.payload as unknown as OrderPayload).lineItems.some((l) => l.sku === 'AUR-MUG-01'),
    );
    expect(withMug).toHaveLength(0);
  });

  it('has one product with a high refund rate', () => {
    const flaskOrders = orders.filter(
      (o) =>
        (o.payload as unknown as OrderPayload).cancelledAt === null &&
        (o.payload as unknown as OrderPayload).lineItems.some((l) => l.sku === 'TRL-FLK-01'),
    );
    const refunded = flaskOrders.filter(
      (o) => (o.payload as unknown as OrderPayload).refunds.length > 0,
    );
    expect(refunded.length / flaskOrders.length).toBeGreaterThan(0.15);
  });

  it('has an underperforming Google campaign and a healthy one', async () => {
    const rows = await withTenant(summary.tenantId, (tx) =>
      tx.select().from(schema.rawGoogleAdsInsights),
    );
    const roasFor = (campaignId: string) => {
      let spend = 0;
      let value = 0;
      for (const row of rows) {
        if (row.campaignId !== campaignId) continue;
        const metrics = (row.payload as { metrics: { costMicros: string; conversionsValue: number } })
          .metrics;
        spend += Number(metrics.costMicros) / 1_000_000;
        value += metrics.conversionsValue;
      }
      return value / spend;
    };
    expect(roasFor('920000000002')).toBeLessThan(1); // pmax-underperformer
    expect(roasFor('920000000001')).toBeGreaterThan(3); // search-brand
  });

  it('flags the tenant as demo', async () => {
    const [tenant] = await withTenant(summary.tenantId, (tx) => tx.select().from(schema.tenants));
    expect(tenant!.isDemo).toBe(true);
  });
});
