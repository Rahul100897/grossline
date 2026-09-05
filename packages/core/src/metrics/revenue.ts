// Revenue and order metrics (docs/metrics.md, Revenue section), computed as
// pure functions over order facts. Daily series plus monthly aggregate;
// cancelled orders are excluded entirely from every revenue metric and only
// appear in cancelled_count / cancelled_rate.
import { dateInZone, monthWindow } from '../time';
import type { OrderFacts } from './order-facts';

/** Structurally matches the db layer's MetricValueInput without importing it. */
export type MetricPoint = {
  metric: string;
  grain: 'day' | 'month';
  period: string;
  scope?: string;
  value: string | number;
  currency?: string | null;
  meta?: Record<string, unknown> | null;
};

const RATE_DECIMALS = 6;
export const rate = (numerator: number, denominator: number): string =>
  denominator === 0 ? '0' : (numerator / denominator).toFixed(RATE_DECIMALS);

type DayBucket = {
  gross: number;
  discounts: number;
  returns: number;
  shipping: number;
  taxes: number;
  orders: number;
  units: number;
};

const emptyBucket = (): DayBucket => ({
  gross: 0,
  discounts: 0,
  returns: 0,
  shipping: 0,
  taxes: 0,
  orders: 0,
  units: 0,
});

export function computeRevenueMetrics(input: {
  facts: OrderFacts[];
  timeZone: string;
  year: number;
  month: number;
}): MetricPoint[] {
  const window = monthWindow(input.timeZone, input.year, input.month);
  const monthPeriod = window.dateStrings[0]!;
  const currency = input.facts.find((f) => !f.cancelled)?.currency ?? null;

  const days = new Map<string, DayBucket>(window.dateStrings.map((d) => [d, emptyBucket()]));
  let cancelledCount = 0;
  let ordersWithReturn = 0;

  for (const fact of input.facts) {
    const day = dateInZone(fact.processedAt, input.timeZone);
    const bucket = days.get(day);
    if (!bucket) continue; // outside this month — caller passed a wider set
    if (fact.cancelled) {
      cancelledCount++;
      continue;
    }
    bucket.orders++;
    bucket.units += fact.units;
    bucket.gross += fact.grossMinor;
    bucket.discounts += fact.discountsMinor;
    bucket.returns += fact.returnsMinor;
    bucket.shipping += fact.shippingChargedMinor - fact.shippingRefundedMinor;
    bucket.taxes += fact.taxMinor;
    if (fact.hasReturn) ordersWithReturn++;
  }

  const points: MetricPoint[] = [];
  const totals = emptyBucket();
  for (const [day, bucket] of days) {
    totals.gross += bucket.gross;
    totals.discounts += bucket.discounts;
    totals.returns += bucket.returns;
    totals.shipping += bucket.shipping;
    totals.taxes += bucket.taxes;
    totals.orders += bucket.orders;
    totals.units += bucket.units;
    const daily: [string, number, boolean][] = [
      ['gross_sales', bucket.gross, true],
      ['discounts', bucket.discounts, true],
      ['returns', bucket.returns, true],
      ['net_sales', bucket.gross - bucket.discounts - bucket.returns, true],
      ['shipping_revenue', bucket.shipping, true],
      ['taxes_collected', bucket.taxes, true],
      ['order_count', bucket.orders, false],
      ['units', bucket.units, false],
    ];
    for (const [metric, value, isMoney] of daily) {
      points.push({ metric, grain: 'day', period: day, value, currency: isMoney ? currency : null });
    }
  }

  const netSales = totals.gross - totals.discounts - totals.returns;
  const monthly: [string, string | number, boolean][] = [
    ['gross_sales', totals.gross, true],
    ['discounts', totals.discounts, true],
    ['returns', totals.returns, true],
    ['net_sales', netSales, true],
    ['shipping_revenue', totals.shipping, true],
    ['taxes_collected', totals.taxes, true],
    ['order_count', totals.orders, false],
    ['units', totals.units, false],
    ['cancelled_count', cancelledCount, false],
    ['aov', totals.orders === 0 ? 0 : Math.round(netSales / totals.orders), true],
    ['units_per_order', rate(totals.units, totals.orders), false],
    ['refund_rate', rate(ordersWithReturn, totals.orders), false],
    ['cancelled_rate', rate(cancelledCount, totals.orders + cancelledCount), false],
  ];
  for (const [metric, value, isMoney] of monthly) {
    points.push({ metric, grain: 'month', period: monthPeriod, value, currency: isMoney ? currency : null });
  }
  return points;
}
