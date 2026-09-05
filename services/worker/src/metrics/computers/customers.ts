import { computeCustomerMetrics } from '@grossline/core';
import type { MetricComputer } from '../pipeline';

export const customersComputer: MetricComputer = {
  name: 'customers',
  async compute(ctx) {
    return computeCustomerMetrics({
      facts: ctx.allFacts,
      timeZone: ctx.tenant.reportingTimezone,
      year: ctx.year,
      month: ctx.month,
      now: ctx.now,
    });
  },
};
