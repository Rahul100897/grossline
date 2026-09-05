import { computeMarginMetrics, type CostInputsSnapshot } from '@grossline/core';
import { listProductCosts, listTenantCostInputs } from '@grossline/db';
import type { MetricComputer } from '../pipeline';
import { loadAdSpendForMonth } from '../ad-spend';

export const marginComputer: MetricComputer = {
  name: 'margin',
  async compute(ctx) {
    const [costRows, inputRows, adSpend] = await Promise.all([
      listProductCosts(ctx.tenant.id),
      listTenantCostInputs(ctx.tenant.id),
      loadAdSpendForMonth(ctx.tenant.id, ctx.window.dateStrings, ctx.tenant.reportingCurrency),
    ]);
    const costInputs: CostInputsSnapshot[] = inputRows.map((r) => ({
      effectiveFrom: r.effectiveFrom,
      paymentFeeBp: r.paymentFeeBp,
      paymentFeeFixedMinor: r.paymentFeeFixedMinor,
      shippingCostPerOrderMinor: r.shippingCostPerOrderMinor,
      fulfilmentCostPerOrderMinor: r.fulfilmentCostPerOrderMinor,
      packagingCostPerOrderMinor: r.packagingCostPerOrderMinor,
    }));
    return computeMarginMetrics({
      facts: ctx.facts,
      costRows,
      costInputs,
      adSpend,
      timeZone: ctx.tenant.reportingTimezone,
      year: ctx.year,
      month: ctx.month,
    });
  },
};
