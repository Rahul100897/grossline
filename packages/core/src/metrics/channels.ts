// Channel mix and claim gap (docs/metrics.md, Channel attribution).
//
// The claim gap is a MEASUREMENT SIGNAL, not a correction: both numbers are
// reported side by side and the gap never adjusts any revenue figure — the
// store-recorded channel revenue rows sum exactly to net sales, by
// construction and by test.
import { monthWindow } from '../time';
import type { OrderFacts, TouchFacts } from './order-facts';
import { platformForSource } from './blended';
import type { PlatformDay } from './ad-platforms';
import { rate, type MetricPoint } from './revenue';

const orderNet = (f: OrderFacts): number => f.grossMinor - f.discountsMinor - f.returnsMinor;

/** Untagged traffic is isolated as 'direct' (docs/metrics.md). */
const sourceOf = (t: TouchFacts | null): string => (t?.source ? t.source.toLowerCase() : 'direct');

function landingPath(t: TouchFacts | null): string | null {
  if (!t?.landingPage) return null;
  try {
    return new URL(t.landingPage).pathname;
  } catch {
    return t.landingPage;
  }
}

export function computeChannelMetrics(input: {
  facts: OrderFacts[];
  /** For the claim gap's platform-reported side. */
  platformDays: PlatformDay[];
  timeZone: string;
  year: number;
  month: number;
}): MetricPoint[] {
  const window = monthWindow(input.timeZone, input.year, input.month);
  const monthPeriod = window.dateStrings[0]!;
  const live = input.facts.filter((f) => !f.cancelled);
  const currency = live[0]?.currency ?? null;

  const firstOrders = new Map<string, number>();
  const firstRevenue = new Map<string, number>();
  const bump = (map: Map<string, number>, key: string, by: number) =>
    map.set(key, (map.get(key) ?? 0) + by);

  const lastOrders = new Map<string, number>();
  const landingOrders = new Map<string, number>();
  const landingRevenue = new Map<string, number>();
  const storeOrdersByPlatform = new Map<string, number>();
  const daysToConversion: number[] = [];

  for (const fact of live) {
    const net = orderNet(fact);
    const first = fact.firstTouch;
    const firstSource = sourceOf(first);
    bump(firstOrders, `source:${firstSource}`, 1);
    bump(firstRevenue, `source:${firstSource}`, net);
    if (first?.medium) {
      bump(firstOrders, `medium:${first.medium.toLowerCase()}`, 1);
      bump(firstRevenue, `medium:${first.medium.toLowerCase()}`, net);
    }
    if (first?.campaign) {
      bump(firstOrders, `campaign:${first.campaign}`, 1);
      bump(firstRevenue, `campaign:${first.campaign}`, net);
    }

    const last = fact.lastTouch ?? fact.firstTouch;
    const lastSource = sourceOf(last);
    bump(lastOrders, `source:${lastSource}`, 1);
    if (last?.medium) bump(lastOrders, `medium:${last.medium.toLowerCase()}`, 1);
    if (last?.campaign) bump(lastOrders, `campaign:${last.campaign}`, 1);

    const path = landingPath(first);
    if (path) {
      bump(landingOrders, `landing:${path}`, 1);
      bump(landingRevenue, `landing:${path}`, net);
    }

    const platform = platformForSource(first?.source ?? null);
    if (platform) bump(storeOrdersByPlatform, platform, 1);

    if (fact.daysToConversion !== null) daysToConversion.push(fact.daysToConversion);
  }

  const points: MetricPoint[] = [];
  for (const [scope, count] of firstOrders) {
    points.push({ metric: 'channel_orders_first_touch', grain: 'month', period: monthPeriod, scope, value: count });
  }
  for (const [scope, revenue] of firstRevenue) {
    points.push({
      metric: 'channel_revenue_first_touch',
      grain: 'month',
      period: monthPeriod,
      scope,
      value: revenue,
      currency,
      meta: { storeRecorded: true },
    });
  }
  for (const [scope, count] of lastOrders) {
    points.push({ metric: 'channel_orders_last_touch', grain: 'month', period: monthPeriod, scope, value: count });
  }
  for (const [scope, count] of landingOrders) {
    points.push({ metric: 'landing_page_orders', grain: 'month', period: monthPeriod, scope, value: count });
  }
  for (const [scope, revenue] of landingRevenue) {
    points.push({ metric: 'landing_page_revenue', grain: 'month', period: monthPeriod, scope, value: revenue, currency });
  }

  if (daysToConversion.length > 0) {
    const sorted = [...daysToConversion].sort((a, b) => a - b);
    const mid = Math.floor(sorted.length / 2);
    const median = sorted.length % 2 === 1 ? sorted[mid]! : (sorted[mid - 1]! + sorted[mid]!) / 2;
    points.push({
      metric: 'days_to_conversion_median',
      grain: 'month',
      period: monthPeriod,
      value: median.toFixed(2),
      meta: { orders: daysToConversion.length },
    });
  }

  // ---- claim gap: platform-reported conversions vs store-recorded orders ----
  const platformConversions = new Map<string, number>();
  for (const day of input.platformDays) {
    if (!window.dateStrings.includes(day.date)) continue;
    const isPlatformRow = day.platform === 'meta' ? day.level === 'account' : day.level === 'campaign';
    if (!isPlatformRow) continue;
    platformConversions.set(day.platform, (platformConversions.get(day.platform) ?? 0) + day.conversions);
  }
  for (const [platform, conversions] of platformConversions) {
    if (conversions <= 0) continue; // no denominator, no gap
    const storeOrders = storeOrdersByPlatform.get(platform) ?? 0;
    points.push({
      metric: 'claim_gap',
      grain: 'month',
      period: monthPeriod,
      scope: `platform:${platform}`,
      value: rate(conversions - storeOrders, conversions),
      meta: {
        platformReportedConversions: conversions,
        storeRecordedOrders: storeOrders,
        notACorrection: true,
      },
    });
  }

  return points;
}
