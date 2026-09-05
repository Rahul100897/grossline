// Golden-file tests for task 2.3 (revenue and order metrics).
//
// EVERY expected value below is HAND-CALCULATED from the recorded fixtures
// (test/fixtures/shopify/recorded-bulk-orders.jsonl + recorded-order-refunds.json),
// never from the implementation. Derivations:
//
// Reporting timezone America/New_York; every processedAt is ~18:10 UTC =
// ~14:10 EDT, so the local calendar day equals the UTC day.
//
// JULY 2026 — #1053 (Jul 23), #1054 (Jul 27); none cancelled:
//   gross    = 1×24.00 + (2×35.00 + 1×18.00)          = 24.00 + 88.00 = 112.00 → 11200
//   discounts= 0 + 8.80                                                        →   880
//   returns  = 0                                                               →     0
//   net      = 11200 − 880 − 0                                                 → 10320
//   shipping = 7.00 + 0                                                        →   700
//   taxes    = 0                                                               →     0
//   orders 2, units 1+3=4, cancelled 0
//   aov = round(10320/2) = 5160; units/order = 4/2 = 2.000000
//   refund_rate 0/2 = 0.000000; cancelled_rate 0/(2+0) = 0.000000
//
// AUGUST 2026 — #1055(Aug1) #1056(Aug6) #1057(Aug11) #1059(Aug21) #1060(Aug26)
// #1061(Aug31) counted; #1058(Aug16) cancelled and excluded:
//   gross: #1055 3×24+2×52+1×99 = 275.00; #1056 2×18+1×52 = 88.00;
//          #1057 2×99 = 198.00; #1059 18+24 = 42.00; #1060 52.00; #1061 2×24 = 48.00
//          total 703.00                                                        → 70300
//   discounts: #1061 5.00                                                      →   500
//   returns (refund line subtotals, original order month):
//          #1056 18.00 (1 of 2 units) + #1057 198.00 (full)                    → 21600
//   net      = 70300 − 500 − 21600                                             → 48200
//   shipping = 12.50 + 5.00 + 0 + 7.00 + 0 + 5.00 (no shipping refunds)        →  2950
//   taxes    = 24.06 + 4.55                                                    →  2861
//   orders 6, units 6+3+2+2+1+2 = 16, cancelled 1
//   aov = round(48200/6) = 8033; units/order = 16/6 = 2.666667
//   refund_rate = 2/6 = 0.333333; cancelled_rate = 1/(6+1) = 0.142857
import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  closeDbPools,
  createStore,
  createTenant,
  getMetricValues,
  listMetricValuesForPeriod,
  schema,
  withTenant,
} from '@grossline/db';
import { eq } from 'drizzle-orm';
import { computeMetricsForMonth } from '../src/metrics/pipeline';
import { loadRecordedOrders } from './helpers/recorded-orders';

let tenantId: string;

async function monthly(metric: string, period: string): Promise<number> {
  const rows = await getMetricValues(tenantId, { metric, grain: 'month', periods: [period] });
  expect(rows, `${metric} ${period}`).toHaveLength(1);
  return Number(rows[0]!.value);
}

async function daily(metric: string, period: string): Promise<number> {
  const rows = await getMetricValues(tenantId, { metric, grain: 'day', periods: [period] });
  expect(rows, `${metric} ${period}`).toHaveLength(1);
  return Number(rows[0]!.value);
}

beforeAll(async () => {
  tenantId = (
    await createTenant({
      name: 'Metrics golden tenant',
      slug: `metrics-${randomUUID().slice(0, 8)}`,
      reportingCurrency: 'USD',
      reportingTimezone: 'America/New_York',
    })
  ).id;
  const store = await createStore({
    tenantId,
    shopDomain: `metrics-${randomUUID().slice(0, 8)}.myshopify.com`,
    storeCurrency: 'USD',
    storeTimezone: 'America/New_York',
  });
  expect(await loadRecordedOrders(tenantId, store.id)).toBe(10);
  await computeMetricsForMonth(tenantId, 2026, 7);
  await computeMetricsForMonth(tenantId, 2026, 8);
});

afterAll(async () => {
  await closeDbPools();
});

describe('revenue metrics — August 2026 golden values', () => {
  it('computes the monthly aggregate exactly', async () => {
    expect(await monthly('gross_sales', '2026-08-01')).toBe(70300);
    expect(await monthly('discounts', '2026-08-01')).toBe(500);
    expect(await monthly('returns', '2026-08-01')).toBe(21600);
    expect(await monthly('net_sales', '2026-08-01')).toBe(48200);
    expect(await monthly('shipping_revenue', '2026-08-01')).toBe(2950);
    expect(await monthly('taxes_collected', '2026-08-01')).toBe(2861);
    expect(await monthly('order_count', '2026-08-01')).toBe(6);
    expect(await monthly('units', '2026-08-01')).toBe(16);
    expect(await monthly('cancelled_count', '2026-08-01')).toBe(1);
    expect(await monthly('aov', '2026-08-01')).toBe(8033);
    expect(await monthly('units_per_order', '2026-08-01')).toBe(2.666667);
    expect(await monthly('refund_rate', '2026-08-01')).toBe(0.333333);
    expect(await monthly('cancelled_rate', '2026-08-01')).toBe(0.142857);
  });

  it('produces the daily series with returns on the original order date', async () => {
    // Aug 1 = #1055 alone.
    expect(await daily('gross_sales', '2026-08-01')).toBe(27500);
    expect(await daily('net_sales', '2026-08-01')).toBe(27500);
    expect(await daily('shipping_revenue', '2026-08-01')).toBe(1250);
    expect(await daily('taxes_collected', '2026-08-01')).toBe(2406);
    expect(await daily('order_count', '2026-08-01')).toBe(1);
    // Aug 6 = #1056: partial refund recognised HERE (order date), not when refunded.
    expect(await daily('returns', '2026-08-06')).toBe(1800);
    expect(await daily('net_sales', '2026-08-06')).toBe(7000);
    // Aug 16 = #1058, cancelled: excluded entirely — a zero day.
    expect(await daily('gross_sales', '2026-08-16')).toBe(0);
    expect(await daily('order_count', '2026-08-16')).toBe(0);
    // An empty day is a real zero row, not a missing row.
    expect(await daily('net_sales', '2026-08-02')).toBe(0);
  });
});

describe('revenue metrics — July 2026 golden values', () => {
  it('computes the monthly aggregate exactly', async () => {
    expect(await monthly('gross_sales', '2026-07-01')).toBe(11200);
    expect(await monthly('discounts', '2026-07-01')).toBe(880);
    expect(await monthly('returns', '2026-07-01')).toBe(0);
    expect(await monthly('net_sales', '2026-07-01')).toBe(10320);
    expect(await monthly('shipping_revenue', '2026-07-01')).toBe(700);
    expect(await monthly('order_count', '2026-07-01')).toBe(2);
    expect(await monthly('units', '2026-07-01')).toBe(4);
    expect(await monthly('aov', '2026-07-01')).toBe(5160);
    expect(await monthly('units_per_order', '2026-07-01')).toBe(2);
    expect(await monthly('refund_rate', '2026-07-01')).toBe(0);
    expect(await monthly('cancelled_rate', '2026-07-01')).toBe(0);
  });
});

describe('recompute safety', () => {
  it('recomputing writes identical values and no duplicate rows', async () => {
    const before = await listMetricValuesForPeriod(tenantId, 'month', '2026-08-01');
    await computeMetricsForMonth(tenantId, 2026, 8);
    const after = await listMetricValuesForPeriod(tenantId, 'month', '2026-08-01');
    expect(after.length).toBe(before.length);
    expect(after.map((r) => [r.metric, r.value])).toEqual(before.map((r) => [r.metric, r.value]));
  });

  it('records the run with a raw watermark', async () => {
    const runs = await withTenant(tenantId, (tx) =>
      tx.select().from(schema.metricRuns).where(eq(schema.metricRuns.status, 'success')),
    );
    expect(runs.length).toBeGreaterThanOrEqual(2);
    expect(runs.every((r) => r.rawWatermark !== null)).toBe(true);
    expect(runs.every((r) => r.metricsWritten > 0)).toBe(true);
  });
});
