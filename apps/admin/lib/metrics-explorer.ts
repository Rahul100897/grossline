// Data assembly for the metrics explorer (docs/phase-3.md task 3.5). One batch
// of period reads (this month, previous month, a year ago) feeds the summary
// with MoM/YoY deltas; the cost-coverage computation feeds the provenance
// panel. Display rules (absent, completeness, provisional, platform-reported,
// provenance) are carried through in the row shape and rendered by the page.
import {
  computeCostCoverage,
  monthWindow,
  previousMonthPeriod,
  yearAgoPeriod,
  type CostCoverage,
} from '@grossline/core';
import {
  getTenant,
  listCostableOrderLines,
  listMetricValuesForPeriod,
  listProductCosts,
  type MetricValueRow,
} from '@grossline/db';

/** Ordered metric groups; anything unlisted falls into "Other". */
export const METRIC_GROUPS: { title: string; metrics: string[] }[] = [
  {
    title: 'Revenue',
    metrics: [
      'gross_sales',
      'discounts',
      'returns',
      'net_sales',
      'shipping_revenue',
      'taxes_collected',
      'order_count',
      'units',
      'units_per_order',
      'aov',
      'refund_rate',
      'cancelled_count',
      'cancelled_rate',
    ],
  },
  {
    title: 'Cost & margin',
    metrics: [
      'cogs',
      'gross_profit',
      'gross_margin_pct',
      'payment_fees',
      'shipping_cost',
      'fulfilment_cost',
      'packaging_cost',
      'contribution_after_ad_spend',
      'full_contribution_margin',
      'break_even_roas',
      'full_contribution_margin_missing_inputs',
    ],
  },
  {
    title: 'Customers',
    metrics: [
      'new_customer_count',
      'new_customer_revenue',
      'new_customer_revenue_share',
      'repeat_rate_30d',
      'repeat_rate_60d',
      'repeat_rate_90d',
      'first_order_contribution',
      'days_to_conversion_median',
      'time_to_second_order_days',
    ],
  },
  {
    title: 'Ad & blended',
    metrics: [
      'total_ad_spend',
      'mer',
      'amer',
      'blended_cac',
      'ad_spend_net_sales_ratio',
      'spend_month_to_date',
      'spend_projected_month_end',
    ],
  },
];

export type MetricMeta = Record<string, unknown>;

export type SummaryRow = {
  metric: string;
  value: number | null;
  currency: string | null;
  momDelta: number | null;
  yoyDelta: number | null;
  meta: MetricMeta;
};

export type ExplorerData = {
  tenantName: string;
  reportingCurrency: string;
  period: string;
  groups: { title: string; rows: SummaryRow[] }[];
  coverage: (CostCoverage & { currency: string }) | null;
};

function tenantLevel(rows: MetricValueRow[]): Map<string, MetricValueRow> {
  const map = new Map<string, MetricValueRow>();
  for (const row of rows) if (row.scope === '') map.set(row.metric, row);
  return map;
}

const num = (row: MetricValueRow | undefined): number | null =>
  row ? Number(row.value) : null;

export async function loadExplorer(
  tenantId: string,
  period: string,
): Promise<ExplorerData | null> {
  const tenant = await getTenant(tenantId);
  if (!tenant) return null;

  const [current, prev, yearAgo] = await Promise.all([
    listMetricValuesForPeriod(tenantId, 'month', period),
    listMetricValuesForPeriod(tenantId, 'month', previousMonthPeriod(period)),
    listMetricValuesForPeriod(tenantId, 'month', yearAgoPeriod(period)),
  ]);

  const cur = tenantLevel(current);
  const prv = tenantLevel(prev);
  const yr = tenantLevel(yearAgo);

  const seen = new Set<string>();
  const buildRow = (metric: string): SummaryRow => {
    seen.add(metric);
    const row = cur.get(metric);
    const value = num(row);
    const prevValue = num(prv.get(metric));
    const yoyValue = num(yr.get(metric));
    return {
      metric,
      value,
      currency: row?.currency ?? null,
      momDelta: value !== null && prevValue !== null ? value - prevValue : null,
      yoyDelta: value !== null && yoyValue !== null ? value - yoyValue : null,
      meta: (row?.meta ?? {}) as MetricMeta,
    };
  };

  const groups = METRIC_GROUPS.map((g) => ({
    title: g.title,
    rows: g.metrics.filter((m) => cur.has(m)).map(buildRow),
  })).filter((g) => g.rows.length > 0);

  // Anything computed but not catalogued still shows, so a new metric is never
  // silently hidden from the explorer.
  const other = [...cur.keys()].filter((m) => !seen.has(m)).sort();
  if (other.length > 0) {
    groups.push({ title: 'Other', rows: other.map(buildRow) });
  }

  // Cost coverage + provenance for the month (same computation the CLI uses).
  let coverage: (CostCoverage & { currency: string }) | null = null;
  const start = new Date(`${period}T00:00:00Z`);
  const window = monthWindow(
    tenant.reportingTimezone,
    start.getUTCFullYear(),
    start.getUTCMonth() + 1,
  );
  const [lines, costs] = await Promise.all([
    listCostableOrderLines(tenantId, { start: window.startUtc, end: window.endUtc }),
    listProductCosts(tenantId),
  ]);
  if (lines.length > 0) {
    coverage = {
      ...computeCostCoverage(lines, costs),
      currency: lines[0]?.currency ?? tenant.reportingCurrency,
    };
  }

  return {
    tenantName: tenant.name,
    reportingCurrency: tenant.reportingCurrency,
    period,
    groups,
    coverage,
  };
}
