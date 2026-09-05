// Golden tests for task 2.5 (margin and contribution).
//
// Part 1: HAND-CALCULATED goldens over the recorded fixtures, August 2026.
// Uploaded costs (effective 2026-01-01): ABT141A-10 6.00, ABT141A-1115 10.00,
// ABT141A-210 5.00, ABT151U-5 15.00; ABT141A-212 (the 99.00 product) is
// DELIBERATELY missing so completeness has something to say.
//
// COGS over net units (ordered − refunded):
//   #1055: 3×6.00 + 2×15.00 (+ 212 missing)        = 48.00
//   #1056: (2−1)×5.00 + 1×15.00                    = 20.00
//   #1057: 212 missing (and fully refunded anyway) =  0
//   #1059: 1×5.00 + 1×6.00                         = 11.00
//   #1060: 1×15.00                                 = 15.00
//   #1061: 2×6.00                                  = 12.00
//   total 106.00 → 10600; lines costed 8/10 → completeness 0.8
// gross_profit = 48200 − 10600 = 37600
// gross_margin_pct = 37600/48200 = 0.780083
// ad spend = 0 (no ad rows) → contribution_after_ad_spend = 37600
//
// Cost inputs (effective 2026-01-01): 2.9% + 0.30 payment, 4.00 shipping,
// 2.50 fulfilment, 1.00 packaging. Payment fees on order totals
// (31156, 9300, 19800, 4900, 5655, 4800):
//   904+30, 270+30, 574+30, 142+30, 164+30, 139+30 → Σ 2373
// shipping 6×400=2400, fulfilment 6×250=1500, packaging 6×100=600 → fees 6873
// full_contribution = 37600 − 6873 = 30727
// break_even_roas = 48200/30727 = 1.568653 (cmr 30727/48200 = 0.637490)
import { randomUUID } from 'node:crypto';
import { afterAll, describe, expect, it } from 'vitest';
import {
  closeDbPools,
  createStore,
  createTenant,
  getMetricValues,
  importShopifyCosts,
  seedDemoTenant,
  upsertProductCosts,
  upsertTenantCostInputs,
} from '@grossline/db';
import { computeMetricsForMonth } from '../src/metrics/pipeline';
import { loadRecordedOrders } from './helpers/recorded-orders';

afterAll(async () => {
  await closeDbPools();
});

async function makeTenant(withInputs: boolean): Promise<string> {
  const tenantId = (
    await createTenant({
      name: 'Margin tenant',
      slug: `margin-${randomUUID().slice(0, 8)}`,
      reportingCurrency: 'USD',
      reportingTimezone: 'America/New_York',
    })
  ).id;
  const store = await createStore({
    tenantId,
    shopDomain: `margin-${randomUUID().slice(0, 8)}.myshopify.com`,
    storeCurrency: 'USD',
    storeTimezone: 'America/New_York',
  });
  await loadRecordedOrders(tenantId, store.id);
  await upsertProductCosts(tenantId, [
    { sku: 'ABT141A-10', unitCostMinor: 600, currency: 'USD', effectiveFrom: '2026-01-01', source: 'upload' },
    { sku: 'ABT141A-1115', unitCostMinor: 1000, currency: 'USD', effectiveFrom: '2026-01-01', source: 'upload' },
    { sku: 'ABT141A-210', unitCostMinor: 500, currency: 'USD', effectiveFrom: '2026-01-01', source: 'upload' },
    { sku: 'ABT151U-5', unitCostMinor: 1500, currency: 'USD', effectiveFrom: '2026-01-01', source: 'upload' },
    // ABT141A-212 deliberately missing
  ]);
  if (withInputs) {
    await upsertTenantCostInputs(tenantId, {
      effectiveFrom: '2026-01-01',
      currency: 'USD',
      paymentFeeBp: 290,
      paymentFeeFixedMinor: 30,
      shippingCostPerOrderMinor: 400,
      fulfilmentCostPerOrderMinor: 250,
      packagingCostPerOrderMinor: 100,
    });
  }
  await computeMetricsForMonth(tenantId, 2026, 8);
  return tenantId;
}

async function monthly(tenantId: string, metric: string) {
  const rows = await getMetricValues(tenantId, { metric, grain: 'month', periods: ['2026-08-01'] });
  expect(rows, metric).toHaveLength(1);
  return rows[0]!;
}

describe('margin metrics — August 2026 golden values', () => {
  it('computes COGS over net units with an honest completeness flag', async () => {
    const tenantId = await makeTenant(true);

    const cogs = await monthly(tenantId, 'cogs');
    expect(Number(cogs.value)).toBe(10600);
    expect(cogs.meta).toMatchObject({ completeness: 0.8, costedLines: 8, totalLines: 10 });

    expect(Number((await monthly(tenantId, 'gross_profit')).value)).toBe(37600);
    expect(Number((await monthly(tenantId, 'gross_margin_pct')).value)).toBe(0.780083);
    expect(Number((await monthly(tenantId, 'contribution_after_ad_spend')).value)).toBe(37600);

    expect(Number((await monthly(tenantId, 'payment_fees')).value)).toBe(2373);
    expect(Number((await monthly(tenantId, 'shipping_cost')).value)).toBe(2400);
    expect(Number((await monthly(tenantId, 'fulfilment_cost')).value)).toBe(1500);
    expect(Number((await monthly(tenantId, 'packaging_cost')).value)).toBe(600);
    expect(Number((await monthly(tenantId, 'full_contribution_margin')).value)).toBe(30727);
    const beRoas = await monthly(tenantId, 'break_even_roas');
    expect(Number(beRoas.value)).toBe(1.568653);
    expect(beRoas.meta).toMatchObject({ contributionMarginRate: '0.637490' });
  });

  it('with no cost inputs, fee-dependent metrics are absent — never zero', async () => {
    const tenantId = await makeTenant(false);
    const full = await getMetricValues(tenantId, {
      metric: 'full_contribution_margin',
      grain: 'month',
      periods: ['2026-08-01'],
    });
    expect(full).toHaveLength(0);
    const marker = await monthly(tenantId, 'full_contribution_margin_missing_inputs');
    expect((marker.meta as { missingInputs: string[] }).missingInputs.length).toBeGreaterThan(0);
    // COGS-based metrics still compute.
    expect(Number((await monthly(tenantId, 'gross_profit')).value)).toBe(37600);
  });
});

describe('demo tenant waterfall (spec done-when)', () => {
  it('gross sales through to full contribution adds up, completeness attached', async () => {
    const summary = await seedDemoTenant(new Date('2026-09-06T12:00:00Z'));
    await importShopifyCosts(summary.tenantId, '2026-09-06');
    await upsertTenantCostInputs(summary.tenantId, {
      effectiveFrom: '2025-01-01',
      currency: 'USD',
      paymentFeeBp: 290,
      paymentFeeFixedMinor: 30,
      shippingCostPerOrderMinor: 550,
      fulfilmentCostPerOrderMinor: 300,
      packagingCostPerOrderMinor: 120,
    });
    await computeMetricsForMonth(summary.tenantId, 2026, 7);

    const value = async (metric: string) => {
      const rows = await getMetricValues(summary.tenantId, {
        metric,
        grain: 'month',
        periods: ['2026-07-01'],
      });
      expect(rows, metric).toHaveLength(1);
      return rows[0]!;
    };

    const gross = Number((await value('gross_sales')).value);
    const discounts = Number((await value('discounts')).value);
    const returns = Number((await value('returns')).value);
    const net = Number((await value('net_sales')).value);
    const cogs = await value('cogs');
    const grossProfit = Number((await value('gross_profit')).value);
    const contribution = Number((await value('contribution_after_ad_spend')).value);
    const fees =
      Number((await value('payment_fees')).value) +
      Number((await value('shipping_cost')).value) +
      Number((await value('fulfilment_cost')).value) +
      Number((await value('packaging_cost')).value);
    const full = Number((await value('full_contribution_margin')).value);

    // The waterfall adds up, step by step.
    expect(gross - discounts - returns).toBe(net);
    expect(net - Number(cogs.value)).toBe(grossProfit);
    const adSpend = grossProfit - contribution;
    expect(adSpend).toBeGreaterThan(0); // demo has real seeded ad spend
    expect(contribution - fees).toBe(full);

    // Completeness is attached and honest.
    const completeness = (cogs.meta as { completeness: number }).completeness;
    expect(completeness).toBeGreaterThan(0);
    expect(completeness).toBeLessThanOrEqual(1);
  }, 120_000);
});
