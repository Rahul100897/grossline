import { computeRevenueMetrics } from '@grossline/core';
import type { MetricComputer } from '../pipeline';

export const revenueComputer: MetricComputer = {
  name: 'revenue',
  async compute(ctx) {
    return computeRevenueMetrics({
      facts: ctx.facts,
      timeZone: ctx.tenant.reportingTimezone,
      year: ctx.year,
      month: ctx.month,
    });
  },
};
