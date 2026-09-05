// Customer metrics (docs/metrics.md, Customers section): new vs returning by
// the store's own customer record, acquisition cohorts, repeat rates.
// Cohort figures are PROVISIONAL until their window closes — the flag travels
// in meta and must never be dropped by a consumer.
import { monthWindow } from '../time';
import type { OrderFacts } from './order-facts';
import { rate, type MetricPoint } from './revenue';

const DAY_MS = 86_400_000;

type CustomerOrders = {
  customerId: string;
  /** Non-cancelled, sorted by processedAt ascending. */
  orders: OrderFacts[];
};

const orderNet = (f: OrderFacts): number => f.grossMinor - f.discountsMinor - f.returnsMinor;

function groupByCustomer(facts: OrderFacts[]): Map<string, CustomerOrders> {
  const map = new Map<string, CustomerOrders>();
  for (const fact of facts) {
    if (fact.cancelled || !fact.customerId) continue;
    const entry = map.get(fact.customerId) ?? { customerId: fact.customerId, orders: [] };
    entry.orders.push(fact);
    map.set(fact.customerId, entry);
  }
  for (const entry of map.values()) {
    entry.orders.sort((a, b) => a.processedAt.getTime() - b.processedAt.getTime());
  }
  return map;
}

function median(values: number[]): number {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 1 ? sorted[mid]! : (sorted[mid - 1]! + sorted[mid]!) / 2;
}

/**
 * A customer is NEW when their earliest order we hold falls in the month AND
 * Shopify's own customerOrderIndex agrees it is their first ever order (index
 * null counts as new — no evidence otherwise). An earliest-held order with
 * index > 1 is a pre-existing customer whose history predates our data
 * (e.g. the 60-day order window) — never counted as new.
 */
export function computeCustomerMetrics(input: {
  /** ALL of the tenant's order facts, not just the month's. */
  facts: OrderFacts[];
  timeZone: string;
  year: number;
  month: number;
  now: Date;
}): MetricPoint[] {
  const window = monthWindow(input.timeZone, input.year, input.month);
  const monthPeriod = window.dateStrings[0]!;
  const currency = input.facts.find((f) => !f.cancelled)?.currency ?? null;
  const customers = groupByCustomer(input.facts);
  const points: MetricPoint[] = [];

  // ---- cohort membership ----
  const cohort: CustomerOrders[] = [];
  for (const entry of customers.values()) {
    const first = entry.orders[0]!;
    const inMonth = first.processedAt >= window.startUtc && first.processedAt < window.endUtc;
    const trulyFirst = first.customerOrderIndex === 1 || first.customerOrderIndex === null;
    if (inMonth && trulyFirst) cohort.push(entry);
  }
  const cohortIds = new Set(cohort.map((c) => c.customerId));

  // ---- new customer count / revenue / share ----
  let monthNet = 0;
  let newCustomerNet = 0;
  for (const fact of input.facts) {
    if (fact.cancelled) continue;
    if (fact.processedAt < window.startUtc || fact.processedAt >= window.endUtc) continue;
    monthNet += orderNet(fact);
    if (fact.customerId && cohortIds.has(fact.customerId)) newCustomerNet += orderNet(fact);
  }
  points.push(
    { metric: 'new_customer_count', grain: 'month', period: monthPeriod, value: cohort.length },
    { metric: 'new_customer_revenue', grain: 'month', period: monthPeriod, value: newCustomerNet, currency },
    { metric: 'new_customer_revenue_share', grain: 'month', period: monthPeriod, value: rate(newCustomerNet, monthNet) },
  );

  // ---- repeat rates (30/60/90) and time to second order ----
  for (const days of [30, 60, 90]) {
    const windowMs = days * DAY_MS;
    const repeated = cohort.filter((c) => {
      const first = c.orders[0]!;
      const second = c.orders[1];
      return second !== undefined && second.processedAt.getTime() - first.processedAt.getTime() <= windowMs;
    }).length;
    // The N-day figure is final only once every cohort member's window closed.
    const provisional = window.endUtc.getTime() + windowMs > input.now.getTime();
    points.push({
      metric: `repeat_rate_${days}d`,
      grain: 'month',
      period: monthPeriod,
      value: rate(repeated, cohort.length),
      meta: { provisional, cohortSize: cohort.length },
    });
  }
  const gaps = cohort
    .filter((c) => c.orders.length >= 2)
    .map((c) => (c.orders[1]!.processedAt.getTime() - c.orders[0]!.processedAt.getTime()) / DAY_MS);
  points.push({
    metric: 'time_to_second_order_days',
    grain: 'month',
    period: monthPeriod,
    value: median(gaps).toFixed(2),
    meta: {
      provisional: window.endUtc.getTime() + 90 * DAY_MS > input.now.getTime(),
      cohortSize: cohort.length,
      withSecondOrder: gaps.length,
    },
  });

  // ---- order frequency distribution (lifetime orders as of month end) ----
  const buckets = { '1': 0, '2': 0, '3': 0, '4plus': 0 };
  for (const entry of customers.values()) {
    const count = entry.orders.filter((o) => o.processedAt < window.endUtc).length;
    if (count === 0) continue;
    if (count === 1) buckets['1']++;
    else if (count === 2) buckets['2']++;
    else if (count === 3) buckets['3']++;
    else buckets['4plus']++;
  }
  for (const [bucket, count] of Object.entries(buckets)) {
    points.push({
      metric: 'customer_order_frequency',
      grain: 'month',
      period: monthPeriod,
      scope: `bucket:${bucket}`,
      value: count,
    });
  }

  // ---- acquisition cohort: cumulative net revenue per customer at m+k ----
  if (cohort.length > 0) {
    for (let k = 0; k <= 11; k++) {
      const offsetMonth = input.month + k;
      const offsetYear = input.year + Math.floor((offsetMonth - 1) / 12);
      const normalizedMonth = ((offsetMonth - 1) % 12) + 1;
      const offsetWindow = monthWindow(input.timeZone, offsetYear, normalizedMonth);
      if (offsetWindow.startUtc > input.now) break; // future offsets don't exist yet
      let cumulative = 0;
      for (const member of cohort) {
        for (const order of member.orders) {
          if (order.processedAt < offsetWindow.endUtc) cumulative += orderNet(order);
        }
      }
      points.push({
        metric: 'cohort_revenue_per_customer',
        grain: 'month',
        period: monthPeriod,
        scope: `offset:${k}`,
        value: Math.round(cumulative / cohort.length),
        currency,
        meta: {
          provisional: offsetWindow.endUtc > input.now,
          cohortSize: cohort.length,
        },
      });
    }
  }

  return points;
}
