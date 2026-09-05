// Blended metrics (docs/metrics.md, Blended). These are the product.
//
// Inputs are net sales facts and CONVERTED ad spend only — platform-reported
// conversions and platform ROAS are not even accepted by this function's
// signature, which is the structural half of "never used in a blended
// calculation" (the behavioural half is proven by test). Ratios whose
// denominator is zero are ABSENT, never a misleading zero.
import { monthWindow } from '../time';
import { latestEffective, resolveUnitCost, type ProductCostRow } from '../costs';
import type { OrderFacts } from './order-facts';
import { acquisitionCohortIds } from './customers';
import type { AdSpendForMonth, CostInputsSnapshot } from './margin';
import { rate, type MetricPoint } from './revenue';

/** Store-recorded first-touch sources that belong to each ad platform. */
export const PLATFORM_SOURCES: Record<string, string[]> = {
  meta: ['facebook', 'instagram', 'fb', 'ig', 'meta'],
  google_ads: ['google', 'adwords', 'google_ads'],
};

export function platformForSource(source: string | null): string | null {
  if (!source) return null;
  const normalized = source.toLowerCase();
  for (const [platform, sources] of Object.entries(PLATFORM_SOURCES)) {
    if (sources.includes(normalized)) return platform;
  }
  return null;
}

const orderNet = (f: OrderFacts): number => f.grossMinor - f.discountsMinor - f.returnsMinor;

export function computeBlendedMetrics(input: {
  /** The month's facts. */
  facts: OrderFacts[];
  /** Full history (cohort membership needs it). */
  allFacts: OrderFacts[];
  costRows: ProductCostRow[];
  costInputs: CostInputsSnapshot[];
  adSpend: AdSpendForMonth;
  timeZone: string;
  year: number;
  month: number;
}): MetricPoint[] {
  const window = monthWindow(input.timeZone, input.year, input.month);
  const monthPeriod = window.dateStrings[0]!;
  const live = input.facts.filter((f) => !f.cancelled);
  const currency = live[0]?.currency ?? null;
  const spend = input.adSpend.totalMinor;
  const fxMeta = input.adSpend.conversion ? { fx: input.adSpend.conversion } : {};

  const netSales = live.reduce((sum, f) => sum + orderNet(f), 0);
  const cohortIds = acquisitionCohortIds(input.allFacts, window);
  const newCustomerOrders = live.filter((f) => f.customerId && cohortIds.has(f.customerId));
  const newCustomerRevenue = newCustomerOrders.reduce((sum, f) => sum + orderNet(f), 0);
  const newCustomerCount = cohortIds.size;

  const points: MetricPoint[] = [
    { metric: 'total_ad_spend', grain: 'month', period: monthPeriod, value: spend, currency, meta: fxMeta },
  ];

  // Ratios: absent when the denominator is zero — never a fake zero.
  if (spend > 0) {
    points.push(
      { metric: 'mer', grain: 'month', period: monthPeriod, value: rate(netSales, spend) },
      { metric: 'amer', grain: 'month', period: monthPeriod, value: rate(newCustomerRevenue, spend) },
      {
        metric: 'ad_spend_net_sales_ratio',
        grain: 'month',
        period: monthPeriod,
        value: netSales > 0 ? rate(spend, netSales) : '0',
      },
    );
    if (newCustomerCount > 0) {
      points.push({
        metric: 'blended_cac',
        grain: 'month',
        period: monthPeriod,
        value: Math.round(spend / newCustomerCount),
        currency,
        meta: { newCustomerCount },
      });
    }
  }

  // ---- first-order contribution vs blended CAC ----
  if (newCustomerCount > 0 && newCustomerOrders.length > 0) {
    let cogs = 0;
    let totalLines = 0;
    let costedLines = 0;
    let fees = 0;
    let feesComplete = true;
    for (const fact of newCustomerOrders) {
      for (const line of fact.lines) {
        if (line.isGiftCard) continue;
        totalLines++;
        const resolved = resolveUnitCost(input.costRows, line, fact.processedAt);
        if (!resolved) continue;
        costedLines++;
        cogs += resolved.unitCostMinor * Math.max(0, line.quantity - line.refundedQuantity);
      }
      const snapshot = latestEffective(input.costInputs, fact.processedAt);
      if (
        !snapshot ||
        (snapshot.paymentFeeBp === null && snapshot.paymentFeeFixedMinor === null) ||
        snapshot.shippingCostPerOrderMinor === null ||
        snapshot.fulfilmentCostPerOrderMinor === null ||
        snapshot.packagingCostPerOrderMinor === null
      ) {
        feesComplete = false;
        continue;
      }
      fees +=
        Math.round((fact.totalPriceMinor * (snapshot.paymentFeeBp ?? 0)) / 10_000) +
        (snapshot.paymentFeeFixedMinor ?? 0) +
        snapshot.shippingCostPerOrderMinor +
        snapshot.fulfilmentCostPerOrderMinor +
        snapshot.packagingCostPerOrderMinor;
    }
    if (feesComplete) {
      const firstOrderContribution = Math.round((newCustomerRevenue - cogs - fees) / newCustomerCount);
      const blendedCac = spend > 0 ? Math.round(spend / newCustomerCount) : null;
      points.push({
        metric: 'first_order_contribution',
        grain: 'month',
        period: monthPeriod,
        value: firstOrderContribution,
        currency,
        meta: {
          completeness: Number(rate(costedLines, Math.max(totalLines, 1))),
          ...(blendedCac !== null
            ? { blendedCacMinor: blendedCac, paysBackOnFirstOrder: firstOrderContribution >= blendedCac }
            : {}),
        },
      });
    }
  }

  // ---- spend share vs store-recorded revenue share, per platform ----
  const revenueByPlatform = new Map<string, number>();
  for (const fact of live) {
    const platform = platformForSource(fact.firstTouch?.source ?? null);
    if (platform) {
      revenueByPlatform.set(platform, (revenueByPlatform.get(platform) ?? 0) + orderNet(fact));
    }
  }
  for (const [platform, platformSpend] of Object.entries(input.adSpend.byPlatform)) {
    if (spend > 0) {
      points.push({
        metric: 'spend_share',
        grain: 'month',
        period: monthPeriod,
        scope: `platform:${platform}`,
        value: rate(platformSpend, spend),
      });
    }
    if (netSales > 0) {
      points.push({
        metric: 'revenue_share',
        grain: 'month',
        period: monthPeriod,
        scope: `platform:${platform}`,
        value: rate(revenueByPlatform.get(platform) ?? 0, netSales),
        meta: { storeRecorded: true, basis: 'first-touch UTM source' },
      });
    }
  }

  return points;
}
