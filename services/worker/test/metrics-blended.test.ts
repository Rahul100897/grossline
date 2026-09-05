// Golden tests for task 2.7 (blended metrics) — the product, so the most
// careful tests in the suite:
//
//   1. HAND-CALCULATED goldens over constructed facts.
//   2. Zero denominators → metrics absent, never zero.
//   3. Platform ROAS is never used: corrupt every stored platform_roas row to
//      an absurd value, recompute, blended output identical — and MER equals
//      an INDEPENDENT naive calculation (own mini-parser over raw payloads).
//
// Hand calculation for part 1 (all USD, tz UTC, August 2026):
//   Order X — new customer (idx 1), net 10000−1000−0 = 9000, total charge
//     9500, 1 line sku S1 qty 2 (cost 2000 → COGS 4000), first touch facebook
//   Order Y — returning (idx 5), net 20000−0−2000 = 18000, first touch google
//   Order Z — cancelled, excluded
//   Spend 9000 (meta 6000, google 3000)
//   net = 27000; MER 27000/9000 = 3.000000; aMER 9000/9000 = 1.000000
//   ad spend ratio 9000/27000 = 0.333333; blended CAC 9000/1 = 9000
//   Fees on X: 2% × 9500 = 190, + shipping 100 + fulfilment 100 + packaging 50
//     = 440 → first-order contribution (9000 − 4000 − 440)/1 = 4560 (< CAC:
//     does NOT pay back on first order)
//   spend share meta 6000/9000 = 0.666667, google 0.333333
//   revenue share meta 9000/27000 = 0.333333, google 18000/27000 = 0.666667
import { randomUUID } from 'node:crypto';
import { afterAll, describe, expect, it } from 'vitest';
import { and, eq, inArray, sql } from 'drizzle-orm';
import {
  computeBlendedMetrics,
  decimalToMinorUnits,
  monthWindow,
  type MetricPoint,
  type OrderFacts,
} from '@grossline/core';
import {
  closeDbPools,
  getMetricValues,
  schema,
  seedDemoTenant,
  withTenant,
} from '@grossline/db';
import { computeMetricsForMonth } from '../src/metrics/pipeline';

const fact = (over: Partial<OrderFacts>): OrderFacts => ({
  orderId: `gid://shopify/Order/${randomUUID()}`,
  processedAt: new Date('2026-08-05T12:00:00Z'),
  cancelled: false,
  currency: 'USD',
  totalPriceMinor: 0,
  grossMinor: 0,
  discountsMinor: 0,
  returnsMinor: 0,
  shippingChargedMinor: 0,
  shippingRefundedMinor: 0,
  taxMinor: 0,
  units: 1,
  hasReturn: false,
  refundedUnits: 0,
  customerId: null,
  customerOrderIndex: null,
  firstTouch: null,
  lastTouch: null,
  daysToConversion: null,
  lines: [],
  ...over,
});

const touch = (source: string) => ({
  source,
  medium: 'paid',
  campaign: null,
  landingPage: null,
  referrerUrl: null,
});

const FACTS: OrderFacts[] = [
  fact({
    customerId: 'cust-new',
    customerOrderIndex: 1,
    grossMinor: 10000,
    discountsMinor: 1000,
    totalPriceMinor: 9500,
    firstTouch: touch('facebook'),
    lines: [
      {
        lineItemId: 'l1',
        sku: 'S1',
        variantId: null,
        quantity: 2,
        refundedQuantity: 0,
        isGiftCard: false,
        originalUnitPriceMinor: 5000,
        discountedUnitPriceMinor: 4500,
      },
    ],
  }),
  fact({
    processedAt: new Date('2026-08-10T12:00:00Z'),
    customerId: 'cust-returning',
    customerOrderIndex: 5,
    grossMinor: 20000,
    returnsMinor: 2000,
    totalPriceMinor: 20000,
    firstTouch: touch('google'),
  }),
  fact({ processedAt: new Date('2026-08-15T12:00:00Z'), cancelled: true, grossMinor: 99999 }),
];

const COST_ROWS = [
  { sku: 'S1', variantId: '', unitCostMinor: 2000, currency: 'USD', effectiveFrom: '2026-01-01', source: 'upload' as const },
];
const COST_INPUTS = [
  {
    effectiveFrom: '2026-01-01',
    paymentFeeBp: 200,
    paymentFeeFixedMinor: 0,
    shippingCostPerOrderMinor: 100,
    fulfilmentCostPerOrderMinor: 100,
    packagingCostPerOrderMinor: 50,
  },
];

const compute = (spendTotal: number) =>
  computeBlendedMetrics({
    facts: FACTS,
    allFacts: FACTS,
    costRows: COST_ROWS,
    costInputs: COST_INPUTS,
    adSpend: {
      totalMinor: spendTotal,
      byPlatform: spendTotal > 0 ? { meta: 6000, google_ads: 3000 } : {},
    },
    timeZone: 'UTC',
    year: 2026,
    month: 8,
  });

const point = (points: MetricPoint[], metric: string, scope = '') =>
  points.find((p) => p.metric === metric && (p.scope ?? '') === scope);

afterAll(async () => {
  await closeDbPools();
});

describe('blended metrics — hand-calculated goldens', () => {
  const points = compute(9000);

  it('MER, aMER, CAC, spend ratio', () => {
    expect(point(points, 'total_ad_spend')!.value).toBe(9000);
    expect(point(points, 'mer')!.value).toBe('3.000000');
    expect(point(points, 'amer')!.value).toBe('1.000000');
    expect(point(points, 'ad_spend_net_sales_ratio')!.value).toBe('0.333333');
    expect(point(points, 'blended_cac')!.value).toBe(9000);
  });

  it('first-order contribution against CAC', () => {
    const foc = point(points, 'first_order_contribution')!;
    expect(foc.value).toBe(4560);
    expect(foc.meta).toMatchObject({
      completeness: 1,
      blendedCacMinor: 9000,
      paysBackOnFirstOrder: false,
    });
  });

  it('spend share vs store-recorded revenue share per platform', () => {
    expect(point(points, 'spend_share', 'platform:meta')!.value).toBe('0.666667');
    expect(point(points, 'spend_share', 'platform:google_ads')!.value).toBe('0.333333');
    expect(point(points, 'revenue_share', 'platform:meta')!.value).toBe('0.333333');
    expect(point(points, 'revenue_share', 'platform:google_ads')!.value).toBe('0.666667');
    expect(point(points, 'revenue_share', 'platform:meta')!.meta).toMatchObject({
      storeRecorded: true,
    });
  });

  it('zero ad spend → ratios are ABSENT, never zero', () => {
    const zeroSpend = compute(0);
    expect(point(zeroSpend, 'total_ad_spend')!.value).toBe(0);
    for (const metric of ['mer', 'amer', 'blended_cac', 'ad_spend_net_sales_ratio']) {
      expect(point(zeroSpend, metric), metric).toBeUndefined();
    }
  });
});

describe('platform ROAS is never used in any blended calculation', () => {
  it('corrupting every stored platform_roas leaves blended output identical, matching an independent MER', async () => {
    const summary = await seedDemoTenant(new Date('2026-09-06T12:00:00Z'));
    await computeMetricsForMonth(summary.tenantId, 2026, 7);
    const merBefore = (
      await getMetricValues(summary.tenantId, { metric: 'mer', grain: 'month', periods: ['2026-07-01'] })
    )[0]!.value;

    // Sabotage: absurd platform ROAS everywhere.
    await withTenant(summary.tenantId, (tx) =>
      tx
        .update(schema.metricValues)
        .set({ value: '999999' })
        .where(eq(schema.metricValues.metric, 'platform_roas')),
    );
    await computeMetricsForMonth(summary.tenantId, 2026, 7);
    const merAfter = (
      await getMetricValues(summary.tenantId, { metric: 'mer', grain: 'month', periods: ['2026-07-01'] })
    )[0]!.value;
    expect(merAfter).toBe(merBefore);

    // Independent naive MER: own mini-parser over raw payloads, no shared code.
    const window = monthWindow('America/New_York', 2026, 7);
    const orders = await withTenant(summary.tenantId, (tx) =>
      tx
        .select({ payload: schema.rawShopifyOrders.payload })
        .from(schema.rawShopifyOrders)
        .where(
          and(
            sql`(${schema.rawShopifyOrders.payload}->>'processedAt')::timestamptz >= ${window.startUtc}`,
            sql`(${schema.rawShopifyOrders.payload}->>'processedAt')::timestamptz < ${window.endUtc}`,
          ),
        ),
    );
    let naiveNet = 0;
    for (const row of orders) {
      const o = row.payload as {
        cancelledAt?: string | null;
        totalDiscountsSet: { shopMoney: { amount: string } };
        lineItems?: { quantity: number; originalUnitPriceSet: { shopMoney: { amount: string } } }[];
        refunds?: { refundLineItems?: { subtotalSet: { shopMoney: { amount: string } } }[] }[];
      };
      if (o.cancelledAt) continue;
      let gross = 0;
      for (const li of o.lineItems ?? []) {
        gross += decimalToMinorUnits(li.originalUnitPriceSet.shopMoney.amount, 'USD') * li.quantity;
      }
      let returns = 0;
      for (const refund of o.refunds ?? []) {
        for (const rli of refund.refundLineItems ?? []) {
          returns += decimalToMinorUnits(rli.subtotalSet.shopMoney.amount, 'USD');
        }
      }
      naiveNet += gross - decimalToMinorUnits(o.totalDiscountsSet.shopMoney.amount, 'USD') - returns;
    }
    const adRows = await withTenant(summary.tenantId, (tx) =>
      tx
        .select({ payload: schema.rawMetaInsights.payload })
        .from(schema.rawMetaInsights)
        .where(
          and(
            eq(schema.rawMetaInsights.level, 'account'),
            inArray(schema.rawMetaInsights.date, window.dateStrings),
          ),
        ),
    );
    let naiveSpend = 0;
    for (const row of adRows) {
      const spend = (row.payload as { spend?: string }).spend;
      if (spend) naiveSpend += decimalToMinorUnits(spend, 'USD');
    }
    const googleRows = await withTenant(summary.tenantId, (tx) =>
      tx
        .select({ payload: schema.rawGoogleAdsInsights.payload })
        .from(schema.rawGoogleAdsInsights)
        .where(inArray(schema.rawGoogleAdsInsights.date, window.dateStrings)),
    );
    for (const row of googleRows) {
      const micros = (row.payload as { metrics?: { costMicros?: string } }).metrics?.costMicros;
      if (micros) naiveSpend += Math.round(Number(micros) / 10_000);
    }
    expect(naiveSpend).toBeGreaterThan(0);
    expect(Number(merAfter)).toBeCloseTo(naiveNet / naiveSpend, 5);
  }, 120_000);
});
