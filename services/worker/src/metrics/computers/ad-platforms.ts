import { computeAdPlatformMetrics } from '@grossline/core';
import { getCostInputsEffectiveOn } from '@grossline/db';
import type { MetricComputer } from '../pipeline';
import { loadPlatformDays } from '../ad-detail';

export const adPlatformsComputer: MetricComputer = {
  name: 'ad-platforms',
  async compute(ctx) {
    const { days } = await loadPlatformDays(
      ctx.tenant.id,
      ctx.window.dateStrings,
      ctx.tenant.reportingCurrency,
    );
    const inputs = await getCostInputsEffectiveOn(ctx.tenant.id, ctx.window.dateStrings.at(-1)!);
    return computeAdPlatformMetrics({
      days,
      monthlySpendTargetMinor: inputs?.monthlySpendTargetMinor ?? null,
      currency: ctx.tenant.reportingCurrency,
      timeZone: ctx.tenant.reportingTimezone,
      year: ctx.year,
      month: ctx.month,
      now: ctx.now,
    });
  },
};
