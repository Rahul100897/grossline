// The comparison engine (Phase 2 task 2.9): ONE implementation used by every
// metric — month over month, year over year, rolling windows over the daily
// series. Missing history is an explicit null (absent), never a zero and
// never a misleading percentage.
import { lastNDates, previousMonthPeriod, yearAgoPeriod } from '@grossline/core';
import { getMetricValues, type MetricGrain } from './metric-values';

export type ComparisonKind = 'previous_period' | 'year_over_year';

export type MetricComparison = {
  metric: string;
  scope: string;
  period: string;
  comparisonPeriod: string;
  kind: ComparisonKind;
  /** null = not computed / no history — absent, never zero. */
  current: number | null;
  previous: number | null;
  delta: number | null;
  /** null when previous is absent OR zero — a percentage would mislead. */
  deltaPct: number | null;
  currency: string | null;
};

export async function compareMetric(
  tenantId: string,
  query: {
    metric: string;
    period: string; // month period, first-of-month date
    kind: ComparisonKind;
    scope?: string;
  },
): Promise<MetricComparison> {
  const comparisonPeriod =
    query.kind === 'previous_period' ? previousMonthPeriod(query.period) : yearAgoPeriod(query.period);
  const [currentRows, previousRows] = await Promise.all([
    getMetricValues(tenantId, {
      metric: query.metric,
      grain: 'month',
      periods: [query.period],
      scope: query.scope,
    }),
    getMetricValues(tenantId, {
      metric: query.metric,
      grain: 'month',
      periods: [comparisonPeriod],
      scope: query.scope,
    }),
  ]);
  const current = currentRows[0] ? Number(currentRows[0].value) : null;
  const previous = previousRows[0] ? Number(previousRows[0].value) : null;
  const delta = current !== null && previous !== null ? current - previous : null;
  const deltaPct =
    delta !== null && previous !== null && previous !== 0
      ? Number((delta / previous).toFixed(6))
      : null;
  return {
    metric: query.metric,
    scope: query.scope ?? '',
    period: query.period,
    comparisonPeriod,
    kind: query.kind,
    current,
    previous,
    delta,
    deltaPct,
    currency: currentRows[0]?.currency ?? previousRows[0]?.currency ?? null,
  };
}

export type RollingWindow = {
  metric: string;
  scope: string;
  endDate: string;
  days: number;
  /** null when no day in the window has data. */
  value: number | null;
  daysWithData: number;
  /** true only when every day in the window carries a row. */
  complete: boolean;
  currency: string | null;
};

/** Rolling 7/28/90 (any n) over the daily series ending at endDate inclusive. */
export async function rollingMetric(
  tenantId: string,
  query: { metric: string; endDate: string; days: number; scope?: string },
): Promise<RollingWindow> {
  const dates = lastNDates(query.endDate, query.days);
  const rows = await getMetricValues(tenantId, {
    metric: query.metric,
    grain: 'day' satisfies MetricGrain,
    periods: dates,
    scope: query.scope,
  });
  const daysWithData = rows.length;
  return {
    metric: query.metric,
    scope: query.scope ?? '',
    endDate: query.endDate,
    days: query.days,
    value: daysWithData === 0 ? null : rows.reduce((sum, r) => sum + Number(r.value), 0),
    daysWithData,
    complete: daysWithData === query.days,
    currency: rows[0]?.currency ?? null,
  };
}
