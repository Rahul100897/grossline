// Golden tests for task 2.8 (channel mix and claim gap).
//
// HAND-CALCULATED goldens over constructed facts (August 2026, UTC):
//   O1 facebook/paid/prospecting, landing /products/a, net 5000, d2c 2
//   O2 facebook/paid/prospecting, landing /,           net 7000, d2c 5
//   O3 google/cpc/brand,          landing /products/a, net 3000, d2c 9
//   O4 untagged (→ direct),       no landing,          net 2000
//   O5 klaviyo/email/newsletter → last touch google,   net 4000, landing /
//   net total = 21000; first-touch source revenue: facebook 12000,
//   google 3000, direct 2000, klaviyo 4000 → sums to 21000 EXACTLY (the gap
//   never adjusts revenue).
//   last-touch source orders: facebook 2, google 2 (O3 + O5), direct 1.
//   days to conversion median of [2, 5, 9] = 5.00.
//   Platform-reported conversions: meta 5, google 2 →
//   claim gap meta = (5 − 2)/5 = 0.600000; google = (2 − 1)/2 = 0.500000.
import { randomUUID } from 'node:crypto';
import { afterAll, describe, expect, it } from 'vitest';
import {
  computeChannelMetrics,
  type MetricPoint,
  type OrderFacts,
  type PlatformDay,
} from '@grossline/core';
import { closeDbPools, getMetricValues, listMetricValuesForPeriod, seedDemoTenant } from '@grossline/db';
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

const touch = (source: string, medium: string, campaign: string, landingPage: string | null) => ({
  source,
  medium,
  campaign,
  landingPage,
  referrerUrl: null,
});

const FACTS: OrderFacts[] = [
  fact({ grossMinor: 5000, daysToConversion: 2, firstTouch: touch('facebook', 'paid', 'prospecting', 'https://s.example/products/a') }),
  fact({ grossMinor: 7000, daysToConversion: 5, firstTouch: touch('facebook', 'paid', 'prospecting', 'https://s.example/') }),
  fact({ grossMinor: 3000, daysToConversion: 9, firstTouch: touch('google', 'cpc', 'brand', 'https://s.example/products/a') }),
  fact({ grossMinor: 2000 }), // untagged → direct
  fact({
    grossMinor: 4000,
    firstTouch: touch('klaviyo', 'email', 'newsletter', 'https://s.example/'),
    lastTouch: touch('google', 'cpc', 'brand', null),
  }),
];

const day = (platform: 'meta' | 'google_ads', conversions: number): PlatformDay => ({
  platform,
  level: platform === 'meta' ? 'account' : 'campaign',
  campaignId: platform === 'meta' ? null : 'c1',
  campaignName: null,
  date: '2026-08-05',
  spendMinor: 1000,
  impressions: 0,
  clicks: 0,
  conversions,
  conversionValueMinor: 0,
});

const points = computeChannelMetrics({
  facts: FACTS,
  platformDays: [day('meta', 5), day('google_ads', 2)],
  timeZone: 'UTC',
  year: 2026,
  month: 8,
});

const point = (metric: string, scope: string): MetricPoint => {
  const found = points.find((p) => p.metric === metric && (p.scope ?? '') === scope);
  expect(found, `${metric} ${scope}`).toBeDefined();
  return found!;
};

afterAll(async () => {
  await closeDbPools();
});

describe('channel mix — hand-calculated goldens', () => {
  it('orders and revenue by first-touch source / medium / campaign', () => {
    expect(point('channel_orders_first_touch', 'source:facebook').value).toBe(2);
    expect(point('channel_revenue_first_touch', 'source:facebook').value).toBe(12000);
    expect(point('channel_orders_first_touch', 'source:direct').value).toBe(1);
    expect(point('channel_revenue_first_touch', 'source:klaviyo').value).toBe(4000);
    expect(point('channel_orders_first_touch', 'medium:paid').value).toBe(2);
    expect(point('channel_orders_first_touch', 'campaign:prospecting').value).toBe(2);
    expect(point('channel_orders_first_touch', 'campaign:newsletter').value).toBe(1);
  });

  it('first-touch revenue sums EXACTLY to net sales — the gap adjusts nothing', () => {
    const total = points
      .filter((p) => p.metric === 'channel_revenue_first_touch' && p.scope!.startsWith('source:'))
      .reduce((sum, p) => sum + Number(p.value), 0);
    expect(total).toBe(21000);
  });

  it('last-touch orders (single-visit orders fall back to first touch)', () => {
    expect(point('channel_orders_last_touch', 'source:facebook').value).toBe(2);
    expect(point('channel_orders_last_touch', 'source:google').value).toBe(2); // O3 + O5
    expect(point('channel_orders_last_touch', 'source:direct').value).toBe(1);
  });

  it('landing page performance and days to conversion', () => {
    expect(point('landing_page_orders', 'landing:/products/a').value).toBe(2);
    expect(point('landing_page_revenue', 'landing:/products/a').value).toBe(8000);
    expect(point('landing_page_orders', 'landing:/').value).toBe(2);
    const d2c = points.find((p) => p.metric === 'days_to_conversion_median')!;
    expect(d2c.value).toBe('5.00');
    expect(d2c.meta).toMatchObject({ orders: 3 });
  });

  it('claim gap: both numbers reported, flagged as not a correction', () => {
    const meta = point('claim_gap', 'platform:meta');
    expect(meta.value).toBe('0.600000'); // (5 − 2) / 5
    expect(meta.meta).toMatchObject({
      platformReportedConversions: 5,
      storeRecordedOrders: 2,
      notACorrection: true,
    });
    const google = point('claim_gap', 'platform:google_ads');
    expect(google.value).toBe('0.500000'); // (2 − 1) / 2
  });
});

describe('demo tenant (spec done-when)', () => {
  it('shows a claim gap consistent with the seeded narrative; revenue never adjusted', async () => {
    const summary = await seedDemoTenant(new Date('2026-09-06T12:00:00Z'));
    await computeMetricsForMonth(summary.tenantId, 2026, 7);

    for (const platform of ['platform:meta', 'platform:google_ads']) {
      const gap = await getMetricValues(summary.tenantId, {
        metric: 'claim_gap',
        grain: 'month',
        periods: ['2026-07-01'],
        scope: platform,
      });
      expect(gap, platform).toHaveLength(1);
      const value = Number(gap[0]!.value);
      expect(value).toBeGreaterThan(-1);
      expect(value).toBeLessThanOrEqual(1);
      expect((gap[0]!.meta as { notACorrection: boolean }).notACorrection).toBe(true);
    }

    // Store-recorded first-touch revenue sums exactly to net sales.
    const monthRows = await listMetricValuesForPeriod(summary.tenantId, 'month', '2026-07-01');
    const netSales = Number(monthRows.find((r) => r.metric === 'net_sales' && r.scope === '')!.value);
    const channelSum = monthRows
      .filter((r) => r.metric === 'channel_revenue_first_touch' && r.scope.startsWith('source:'))
      .reduce((sum, r) => sum + Number(r.value), 0);
    expect(channelSum).toBe(netSales);

    // And no metric anywhere presents the gap as a corrected conversion count.
    expect(monthRows.some((r) => /corrected/i.test(r.metric))).toBe(false);
  }, 120_000);
});
