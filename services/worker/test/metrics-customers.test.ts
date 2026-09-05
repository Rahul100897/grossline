// Golden tests for task 2.4 (customer metrics).
//
// Part 1: HAND-CALCULATED goldens over the recorded fixtures. Customer map
// (from recorded-bulk-orders.jsonl; net = gross − discounts − returns):
//   A …001: #1053 Jul 23 idx1 (net 2400), #1059 Aug 21 idx2 (net 4200)
//   B …002: #1054 Jul 27 idx2, #1056 Aug 6 idx3, #1061 Aug 31 idx4
//   C …003: #1055 Aug 1 idx2, #1057 Aug 11 idx3, #1062 Sep 3 idx4
//   D …004: #1058 Aug 16 idx49 CANCELLED, #1060 Aug 26 idx50
// Only A is ever NEW (idx 1), in July. B/C/D predate our data (idx > 1 on
// their earliest held order) and must never be counted as new.
//
// July: cohort {A}; second order 29d + 70s after the first → 29.00 days;
// repeat 30/60/90 all 1.000000. new_customer_revenue = 2400;
// share = 2400/10320 = 0.232558. Frequency to Jul 31: A=1, B=1 → bucket1=2.
// Cohort revenue/customer: m+0 = 2400; m+1 = 2400+4200 = 6600; m+2 = 6600.
//
// August: cohort empty. Frequency to Aug 31 (non-cancelled): A=2, B=3, C=2,
// D=1 → bucket1=1, bucket2=2, bucket3=1.
//
// Part 2: the demo tenant's cohort curves cross-checked against an
// INDEPENDENT naive implementation in this file (not the metric layer).
import { randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterAll, describe, expect, it } from 'vitest';
import {
  computeCustomerMetrics,
  monthWindow,
  orderFactsFromPayload,
  type MetricPoint,
  type OrderFacts,
} from '@grossline/core';
import { closeDbPools, createStore, createTenant, getMetricValues, seedDemoTenant } from '@grossline/db';
import { reassembleJsonl } from '../src/connectors/shopify/bulk';
import { flattenConnections } from '../src/connectors/shopify/client';
import { computeMetricsForMonth } from '../src/metrics/pipeline';
import { loadOrderFactsForWindow } from '../src/metrics/load';
import { loadRecordedOrders } from './helpers/recorded-orders';

const NOW = new Date('2026-09-06T12:00:00Z');
const fixturesDir = join(dirname(fileURLToPath(import.meta.url)), 'fixtures', 'shopify');
const fixture = (name: string) => readFileSync(join(fixturesDir, name), 'utf8');

function recordedFacts(): OrderFacts[] {
  const roots = reassembleJsonl(
    fixture('recorded-bulk-orders.jsonl')
      .split('\n')
      .filter((l) => l.trim().length > 0),
  );
  const refunds = JSON.parse(fixture('recorded-order-refunds.json')) as Record<
    string,
    { refunds: unknown[] } | string
  >;
  return roots
    .filter((r) => typeof r.id === 'string' && (r.id as string).includes('/Order/'))
    .map((order) => {
      const enrichment = refunds[order.id as string];
      if (enrichment && typeof enrichment !== 'string') {
        order.refunds = flattenConnections(enrichment.refunds) as unknown[];
      }
      return orderFactsFromPayload(order);
    });
}

const point = (points: MetricPoint[], metric: string, scope = ''): MetricPoint => {
  const found = points.find((p) => p.metric === metric && (p.scope ?? '') === scope);
  expect(found, `${metric} ${scope}`).toBeDefined();
  return found!;
};

afterAll(async () => {
  await closeDbPools();
});

describe('customer metrics — July 2026 golden values (hand-calculated)', () => {
  const points = computeCustomerMetrics({
    facts: recordedFacts(),
    timeZone: 'America/New_York',
    year: 2026,
    month: 7,
    now: NOW,
  });

  it('counts exactly one new customer and their revenue', () => {
    expect(point(points, 'new_customer_count').value).toBe(1);
    expect(point(points, 'new_customer_revenue').value).toBe(2400);
    expect(point(points, 'new_customer_revenue_share').value).toBe('0.232558');
  });

  it('computes cohort repeat rates with correct provisional flags', () => {
    const r30 = point(points, 'repeat_rate_30d');
    expect(r30.value).toBe('1.000000');
    expect(r30.meta).toMatchObject({ provisional: false, cohortSize: 1 }); // Jul end + 30d < now
    const r60 = point(points, 'repeat_rate_60d');
    expect(r60.value).toBe('1.000000');
    expect(r60.meta).toMatchObject({ provisional: true }); // window still open
    expect(point(points, 'repeat_rate_90d').meta).toMatchObject({ provisional: true });
  });

  it('computes time to second order from the cohort', () => {
    const ttso = point(points, 'time_to_second_order_days');
    expect(ttso.value).toBe('29.00');
    expect(ttso.meta).toMatchObject({ withSecondOrder: 1, provisional: true });
  });

  it('buckets order frequency as of month end', () => {
    expect(point(points, 'customer_order_frequency', 'bucket:1').value).toBe(2);
    expect(point(points, 'customer_order_frequency', 'bucket:2').value).toBe(0);
  });

  it('builds the cohort revenue-per-customer curve', () => {
    expect(point(points, 'cohort_revenue_per_customer', 'offset:0')).toMatchObject({
      value: 2400,
      meta: { provisional: false, cohortSize: 1 },
    });
    expect(point(points, 'cohort_revenue_per_customer', 'offset:1')).toMatchObject({
      value: 6600,
      meta: { provisional: false, cohortSize: 1 },
    });
    expect(point(points, 'cohort_revenue_per_customer', 'offset:2')).toMatchObject({
      value: 6600,
      meta: { provisional: true, cohortSize: 1 }, // September is still open
    });
    expect(points.filter((p) => p.metric === 'cohort_revenue_per_customer')).toHaveLength(3);
  });
});

describe('customer metrics — August 2026 golden values (hand-calculated)', () => {
  const points = computeCustomerMetrics({
    facts: recordedFacts(),
    timeZone: 'America/New_York',
    year: 2026,
    month: 8,
    now: NOW,
  });

  it('finds no new customers — pre-existing customers never count as new', () => {
    expect(point(points, 'new_customer_count').value).toBe(0);
    expect(point(points, 'new_customer_revenue').value).toBe(0);
    expect(point(points, 'new_customer_revenue_share').value).toBe('0.000000'); // 0 / 48200
  });

  it('buckets lifetime order frequency, cancelled orders excluded', () => {
    expect(point(points, 'customer_order_frequency', 'bucket:1').value).toBe(1); // D (#1058 cancelled)
    expect(point(points, 'customer_order_frequency', 'bucket:2').value).toBe(2); // A, C
    expect(point(points, 'customer_order_frequency', 'bucket:3').value).toBe(1); // B
    expect(point(points, 'customer_order_frequency', 'bucket:4plus').value).toBe(0);
  });

  it('emits no cohort curve for an empty cohort', () => {
    expect(points.filter((p) => p.metric === 'cohort_revenue_per_customer')).toHaveLength(0);
  });
});

describe('pipeline integration', () => {
  it('persists customer metrics with provisional flags intact', async () => {
    const tenantId = (
      await createTenant({
        name: 'Customer metrics tenant',
        slug: `cust-${randomUUID().slice(0, 8)}`,
        reportingCurrency: 'USD',
        reportingTimezone: 'America/New_York',
      })
    ).id;
    const store = await createStore({
      tenantId,
      shopDomain: `cust-${randomUUID().slice(0, 8)}.myshopify.com`,
      storeCurrency: 'USD',
      storeTimezone: 'America/New_York',
    });
    await loadRecordedOrders(tenantId, store.id);
    await computeMetricsForMonth(tenantId, 2026, 7);

    const count = await getMetricValues(tenantId, {
      metric: 'new_customer_count',
      grain: 'month',
      periods: ['2026-07-01'],
    });
    expect(Number(count[0]!.value)).toBe(1);
    const r90 = await getMetricValues(tenantId, {
      metric: 'repeat_rate_90d',
      grain: 'month',
      periods: ['2026-07-01'],
    });
    expect((r90[0]!.meta as { provisional: boolean }).provisional).toBe(true);
  });
});

describe('demo tenant cohort cross-check (independent naive implementation)', () => {
  it('cohort revenue per customer matches a from-scratch calculation', async () => {
    const summary = await seedDemoTenant(NOW);
    const { facts } = await loadOrderFactsForWindow(summary.tenantId, {
      startUtc: new Date(0),
      endUtc: new Date(NOW.getTime() + 86_400_000),
    });

    // Pick a mature cohort month: 10 months before now.
    const cohortYear = 2025;
    const cohortMonth = 11;
    const tz = 'America/New_York';

    // ---- independent naive calculation (no metric-layer code) ----
    const window = monthWindow(tz, cohortYear, cohortMonth);
    const byCustomer = new Map<string, OrderFacts[]>();
    for (const f of facts) {
      if (f.cancelled || !f.customerId) continue;
      (byCustomer.get(f.customerId) ?? byCustomer.set(f.customerId, []).get(f.customerId)!).push(f);
    }
    const cohort: string[] = [];
    for (const [customerId, orders] of byCustomer) {
      orders.sort((a, b) => a.processedAt.getTime() - b.processedAt.getTime());
      const first = orders[0]!;
      const isFirstEver = first.customerOrderIndex === 1 || first.customerOrderIndex === null;
      if (isFirstEver && first.processedAt >= window.startUtc && first.processedAt < window.endUtc) {
        cohort.push(customerId);
      }
    }
    expect(cohort.length).toBeGreaterThan(0);
    const offset2 = monthWindow(tz, 2026, 1); // m+2
    let cumulative = 0;
    for (const customerId of cohort) {
      for (const order of byCustomer.get(customerId)!) {
        if (order.processedAt < offset2.endUtc) {
          cumulative += order.grossMinor - order.discountsMinor - order.returnsMinor;
        }
      }
    }
    const naive = Math.round(cumulative / cohort.length);

    // ---- the metric layer ----
    const points = computeCustomerMetrics({
      facts,
      timeZone: tz,
      year: cohortYear,
      month: cohortMonth,
      now: NOW,
    });
    const layerPoint = points.find(
      (p) => p.metric === 'cohort_revenue_per_customer' && p.scope === 'offset:2',
    )!;
    expect(layerPoint.value).toBe(naive);
    expect((layerPoint.meta as { cohortSize: number }).cohortSize).toBe(cohort.length);
    expect((layerPoint.meta as { provisional: boolean }).provisional).toBe(false);
  }, 120_000);
});
