import { computeChannelMetrics } from '@grossline/core';
import type { MetricComputer } from '../pipeline';
import { loadPlatformDays } from '../ad-detail';

export const channelsComputer: MetricComputer = {
  name: 'channels',
  async compute(ctx) {
    const { days } = await loadPlatformDays(
      ctx.tenant.id,
      ctx.window.dateStrings,
      ctx.tenant.reportingCurrency,
    );
    return computeChannelMetrics({
      facts: ctx.facts,
      platformDays: days,
      timeZone: ctx.tenant.reportingTimezone,
      year: ctx.year,
      month: ctx.month,
    });
  },
};
