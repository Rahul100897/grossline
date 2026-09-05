// Ad platform metrics (docs/metrics.md, Ad platforms). Everything here is
// platform-reported and labelled as such; conversions and ROAS are NEVER
// summed across platforms and never enter a blended calculation — there is
// deliberately no tenant-level (scope '') row for any platform-reported
// figure.
import { monthWindow } from '../time';
import { rate, type MetricPoint } from './revenue';

export type PlatformDay = {
  platform: 'meta' | 'google_ads';
  /** 'account' rows carry the platform's own totals; 'campaign' rows one campaign. */
  level: 'account' | 'campaign';
  campaignId: string | null;
  campaignName: string | null;
  date: string;
  /** Converted to reporting currency, integer minor units. */
  spendMinor: number;
  impressions: number;
  clicks: number;
  conversions: number;
  conversionValueMinor: number;
};

type Totals = {
  spend: number;
  impressions: number;
  clicks: number;
  conversions: number;
  conversionValue: number;
  campaignName: string | null;
};

const emptyTotals = (): Totals => ({
  spend: 0,
  impressions: 0,
  clicks: 0,
  conversions: 0,
  conversionValue: 0,
  campaignName: null,
});

function metricSet(scope: string, totals: Totals, period: string, currency: string | null): MetricPoint[] {
  const meta = { platformReported: true, ...(totals.campaignName ? { campaignName: totals.campaignName } : {}) };
  return [
    { metric: 'ad_spend', grain: 'month', period, scope, value: totals.spend, currency },
    { metric: 'ad_impressions', grain: 'month', period, scope, value: totals.impressions },
    { metric: 'ad_clicks', grain: 'month', period, scope, value: totals.clicks },
    {
      metric: 'ad_cpm',
      grain: 'month',
      period,
      scope,
      value: totals.impressions === 0 ? 0 : Math.round((totals.spend * 1000) / totals.impressions),
      currency,
    },
    {
      metric: 'ad_cpc',
      grain: 'month',
      period,
      scope,
      value: totals.clicks === 0 ? 0 : Math.round(totals.spend / totals.clicks),
      currency,
    },
    { metric: 'ad_ctr', grain: 'month', period, scope, value: rate(totals.clicks, totals.impressions) },
    { metric: 'platform_conversions', grain: 'month', period, scope, value: totals.conversions.toFixed(2), meta },
    { metric: 'platform_conversion_value', grain: 'month', period, scope, value: totals.conversionValue, currency, meta },
    {
      metric: 'platform_roas',
      grain: 'month',
      period,
      scope,
      value: rate(totals.conversionValue, totals.spend),
      meta: { ...meta, referenceOnly: true, neverBlended: true },
    },
  ];
}

/**
 * Platform totals come from the platform's own account-level rows where it
 * publishes them (Meta) and from the sum of campaign rows otherwise (Google,
 * whose total IS the campaign sum) — so stored totals match the raw tables
 * exactly.
 */
export function computeAdPlatformMetrics(input: {
  days: PlatformDay[];
  monthlySpendTargetMinor: number | null;
  currency: string | null;
  timeZone: string;
  year: number;
  month: number;
  now: Date;
}): MetricPoint[] {
  const window = monthWindow(input.timeZone, input.year, input.month);
  const monthPeriod = window.dateStrings[0]!;
  const inMonth = input.days.filter((d) => window.dateStrings.includes(d.date));

  const platformTotals = new Map<string, Totals>();
  const campaignTotals = new Map<string, Totals>();
  const dailySpendByPlatform = new Map<string, Map<string, number>>();

  for (const day of inMonth) {
    const usesAccountRows = day.platform === 'meta';
    const isPlatformRow = usesAccountRows ? day.level === 'account' : day.level === 'campaign';
    if (isPlatformRow) {
      const totals = platformTotals.get(day.platform) ?? emptyTotals();
      totals.spend += day.spendMinor;
      totals.impressions += day.impressions;
      totals.clicks += day.clicks;
      totals.conversions += day.conversions;
      totals.conversionValue += day.conversionValueMinor;
      platformTotals.set(day.platform, totals);
      const byDate = dailySpendByPlatform.get(day.platform) ?? new Map<string, number>();
      byDate.set(day.date, (byDate.get(day.date) ?? 0) + day.spendMinor);
      dailySpendByPlatform.set(day.platform, byDate);
    }
    if (day.level === 'campaign' && day.campaignId) {
      const key = `${day.platform}:${day.campaignId}`;
      const totals = campaignTotals.get(key) ?? emptyTotals();
      totals.spend += day.spendMinor;
      totals.impressions += day.impressions;
      totals.clicks += day.clicks;
      totals.conversions += day.conversions;
      totals.conversionValue += day.conversionValueMinor;
      totals.campaignName = day.campaignName ?? totals.campaignName;
      campaignTotals.set(key, totals);
    }
  }

  const points: MetricPoint[] = [];
  for (const [platform, totals] of platformTotals) {
    points.push(...metricSet(`platform:${platform}`, totals, monthPeriod, input.currency));
    for (const date of window.dateStrings) {
      points.push({
        metric: 'ad_spend',
        grain: 'day',
        period: date,
        scope: `platform:${platform}`,
        value: dailySpendByPlatform.get(platform)?.get(date) ?? 0,
        currency: input.currency,
      });
    }
  }
  for (const [key, totals] of campaignTotals) {
    points.push(...metricSet(`campaign:${key}`, totals, monthPeriod, input.currency));
  }

  // ---- budget pacing (tenant level, spend only — no platform-reported figures) ----
  const totalSpend = [...platformTotals.values()].reduce((sum, t) => sum + t.spend, 0);
  const daysInMonth = window.dateStrings.length;
  const msElapsed = Math.min(input.now.getTime(), window.endUtc.getTime()) - window.startUtc.getTime();
  const daysElapsed = Math.max(1, Math.min(daysInMonth, Math.ceil(msElapsed / 86_400_000)));
  const monthClosed = input.now >= window.endUtc;
  const projected = monthClosed ? totalSpend : Math.round((totalSpend / daysElapsed) * daysInMonth);
  const pacingMeta = {
    daysElapsed,
    daysInMonth,
    monthClosed,
    ...(input.monthlySpendTargetMinor !== null ? { targetMinor: input.monthlySpendTargetMinor } : {}),
  };
  points.push(
    { metric: 'spend_month_to_date', grain: 'month', period: monthPeriod, value: totalSpend, currency: input.currency, meta: pacingMeta },
    { metric: 'spend_projected_month_end', grain: 'month', period: monthPeriod, value: projected, currency: input.currency, meta: pacingMeta },
  );

  return points;
}
