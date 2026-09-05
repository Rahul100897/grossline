// Phase 2 exit criterion: the metric layer and the task-1.7 reconciliation
// reference math AGREE, as two independent implementations. The reconcile
// harness was deliberately NOT refactored to call the metric layer — two
// implementations that agree is a real check; one checking itself is theatre.
import { afterAll, describe, expect, it } from 'vitest';
import { closeDbPools, getMetricValues, getTenant, seedDemoTenant } from '@grossline/db';
import { computeOurTotals } from '../src/reconcile';
import { computeMetricsForMonth } from '../src/metrics/pipeline';

afterAll(async () => {
  await closeDbPools();
});

describe('metric layer vs 1.7 reference math (independent implementations)', () => {
  it('monthly totals match exactly on the demo tenant', async () => {
    const summary = await seedDemoTenant(new Date('2026-09-06T12:00:00Z'));
    const tenant = (await getTenant(summary.tenantId))!;

    for (const month of [6, 7] as const) {
      await computeMetricsForMonth(tenant.id, 2026, month);
      const reference = await computeOurTotals(tenant, 2026, month);
      const period = `2026-0${month}-01`;

      const metric = async (name: string, scope = ''): Promise<number> => {
        const rows = await getMetricValues(tenant.id, {
          metric: name,
          grain: 'month',
          periods: [period],
          scope,
        });
        expect(rows, `${name} ${period}`).toHaveLength(1);
        return Number(rows[0]!.value);
      };

      expect(await metric('net_sales')).toBe(reference.shopifyNetSalesCents);
      expect(await metric('order_count')).toBe(reference.shopifyOrders);
      expect(await metric('new_customer_count')).toBe(reference.newCustomers);
      expect(await metric('ad_spend', 'platform:meta')).toBe(reference.metaSpendCents);
      expect(await metric('ad_spend', 'platform:google_ads')).toBe(reference.googleCostCents);
      expect(await metric('total_ad_spend')).toBe(
        reference.metaSpendCents + reference.googleCostCents,
      );
    }
  }, 180_000);
});
