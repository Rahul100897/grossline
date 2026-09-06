// One place that turns a stored metric value into display text, honouring the
// value's own currency and the naming conventions in docs/metrics.md. Absent
// stays absent: null in, null out — the caller renders <Absent>.
import { formatMinor, formatCount, formatPct, formatRatio } from './format';

const PERCENT = /(_pct|_rate|_share|_ratio)$|^ad_ctr$|^claim_gap$/;
const RATIO = new Set([
  'mer',
  'amer',
  'break_even_roas',
  'platform_roas',
  'units_per_order',
  'customer_order_frequency',
]);
const DAYS = new Set(['days_to_conversion_median', 'time_to_second_order_days']);

export type MetricKind = 'money' | 'percent' | 'ratio' | 'days' | 'count';

export function metricKind(metric: string, currency: string | null): MetricKind {
  if (currency) return 'money';
  if (PERCENT.test(metric)) return 'percent';
  if (RATIO.has(metric)) return 'ratio';
  if (DAYS.has(metric)) return 'days';
  return 'count';
}

/** Formatted value, or null when the input is absent. */
export function formatMetric(
  value: number | null | undefined,
  metric: string,
  currency: string | null,
): string | null {
  if (value === null || value === undefined) return null;
  switch (metricKind(metric, currency)) {
    case 'money':
      return formatMinor(value, currency);
    case 'percent':
      return formatPct(value);
    case 'ratio':
      return formatRatio(value);
    case 'days': {
      const d = formatRatio(value, 1);
      return d === null ? null : `${d}d`;
    }
    case 'count':
      return Number.isInteger(value) ? formatCount(value) : formatRatio(value, 2);
  }
}

/** A signed delta rendered in the metric's own units (money/percent-points/…). */
export function formatDelta(
  delta: number | null,
  metric: string,
  currency: string | null,
): { text: string; negative: boolean } | null {
  if (delta === null) return null;
  const negative = delta < 0;
  const magnitude = Math.abs(delta);
  const kind = metricKind(metric, currency);
  let body: string | null;
  if (kind === 'money') body = formatMinor(magnitude, currency);
  else if (kind === 'percent') body = formatPct(magnitude);
  else if (kind === 'ratio') body = formatRatio(magnitude);
  else if (kind === 'days') {
    const d = formatRatio(magnitude, 1);
    body = d === null ? null : `${d}d`;
  } else body = Number.isInteger(magnitude) ? formatCount(magnitude) : formatRatio(magnitude, 2);
  if (body === null) return null;
  return { text: `${negative ? '−' : '+'}${body}`, negative };
}
