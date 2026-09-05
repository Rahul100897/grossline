// Margin and contribution (docs/metrics.md, Cost and margin). Missing cost
// data produces completeness flags, never a silently wrong number: COGS
// counts only lines whose cost resolves, and every margin metric carries the
// completeness rate in meta. Fee-dependent metrics are only emitted when the
// merchant has supplied cost inputs — missing inputs are missing, not zero.
import { monthWindow } from '../time';
import { latestEffective, resolveUnitCost, type ProductCostRow } from '../costs';
import type { OrderFacts } from './order-facts';
import { rate, type MetricPoint } from './revenue';

export type CostInputsSnapshot = {
  effectiveFrom: string;
  paymentFeeBp: number | null;
  paymentFeeFixedMinor: number | null;
  shippingCostPerOrderMinor: number | null;
  fulfilmentCostPerOrderMinor: number | null;
  packagingCostPerOrderMinor: number | null;
};

export type AdSpendForMonth = {
  /** Converted to the reporting currency, integer minor units. */
  totalMinor: number;
  byPlatform: Record<string, number>;
  /** FX traceability (rates and dates used), for meta. */
  conversion?: Record<string, unknown>;
};

export function computeMarginMetrics(input: {
  /** The month's facts only. */
  facts: OrderFacts[];
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

  // ---- COGS over net units (ordered minus refunded), cost on the order date ----
  let cogsMinor = 0;
  let totalLines = 0;
  let costedLines = 0;
  let netSales = 0;
  for (const fact of live) {
    netSales += fact.grossMinor - fact.discountsMinor - fact.returnsMinor;
    for (const line of fact.lines) {
      if (line.isGiftCard) continue;
      totalLines++;
      const resolved = resolveUnitCost(input.costRows, line, fact.processedAt);
      if (!resolved) continue; // missing is missing — never zero
      costedLines++;
      const netUnits = Math.max(0, line.quantity - line.refundedQuantity);
      cogsMinor += resolved.unitCostMinor * netUnits;
    }
  }
  const completeness = totalLines === 0 ? 1 : costedLines / totalLines;
  const completenessMeta = {
    completeness: Number(rate(costedLines, Math.max(totalLines, 1))),
    costedLines,
    totalLines,
  };

  const grossProfit = netSales - cogsMinor;
  const contributionAfterAdSpend = grossProfit - input.adSpend.totalMinor;

  const points: MetricPoint[] = [
    { metric: 'cogs', grain: 'month', period: monthPeriod, value: cogsMinor, currency, meta: completenessMeta },
    { metric: 'gross_profit', grain: 'month', period: monthPeriod, value: grossProfit, currency, meta: completenessMeta },
    {
      metric: 'gross_margin_pct',
      grain: 'month',
      period: monthPeriod,
      value: rate(grossProfit, netSales),
      meta: completenessMeta,
    },
    {
      metric: 'contribution_after_ad_spend',
      grain: 'month',
      period: monthPeriod,
      value: contributionAfterAdSpend,
      currency,
      meta: { ...completenessMeta, ...(input.adSpend.conversion ? { fx: input.adSpend.conversion } : {}) },
    },
  ];

  // ---- merchant-supplied per-order costs (resolved per order date) ----
  let paymentFees = 0;
  let shippingCost = 0;
  let fulfilmentCost = 0;
  let packagingCost = 0;
  const missingInputs = new Set<string>();
  let anySnapshot = false;
  for (const fact of live) {
    const snapshot = latestEffective(input.costInputs, fact.processedAt);
    if (!snapshot) {
      missingInputs.add('no cost inputs effective on some order dates');
      continue;
    }
    anySnapshot = true;
    if (snapshot.paymentFeeBp === null && snapshot.paymentFeeFixedMinor === null) {
      missingInputs.add('payment fee');
    } else {
      paymentFees +=
        Math.round((fact.totalPriceMinor * (snapshot.paymentFeeBp ?? 0)) / 10_000) +
        (snapshot.paymentFeeFixedMinor ?? 0);
    }
    if (snapshot.shippingCostPerOrderMinor === null) missingInputs.add('shipping cost');
    else shippingCost += snapshot.shippingCostPerOrderMinor;
    if (snapshot.fulfilmentCostPerOrderMinor === null) missingInputs.add('fulfilment cost');
    else fulfilmentCost += snapshot.fulfilmentCostPerOrderMinor;
    if (snapshot.packagingCostPerOrderMinor === null) missingInputs.add('packaging cost');
    else packagingCost += snapshot.packagingCostPerOrderMinor;
  }

  if (anySnapshot && missingInputs.size === 0) {
    const fees = paymentFees + shippingCost + fulfilmentCost + packagingCost;
    const contributionBeforeAd = grossProfit - fees;
    const fullContribution = contributionBeforeAd - input.adSpend.totalMinor;
    const feeMetrics: [string, number][] = [
      ['payment_fees', paymentFees],
      ['shipping_cost', shippingCost],
      ['fulfilment_cost', fulfilmentCost],
      ['packaging_cost', packagingCost],
    ];
    for (const [metric, value] of feeMetrics) {
      points.push({ metric, grain: 'month', period: monthPeriod, value, currency });
    }
    points.push(
      {
        metric: 'full_contribution_margin',
        grain: 'month',
        period: monthPeriod,
        value: fullContribution,
        currency,
        meta: completenessMeta,
      },
      {
        metric: 'break_even_roas',
        grain: 'month',
        period: monthPeriod,
        value: contributionBeforeAd <= 0 ? '0' : rate(netSales, contributionBeforeAd),
        meta: { ...completenessMeta, contributionMarginRate: rate(contributionBeforeAd, netSales) },
      },
    );
  } else if (live.length > 0) {
    // Fee-dependent metrics are NOT emitted with silently-assumed zeros.
    points.push({
      metric: 'full_contribution_margin_missing_inputs',
      grain: 'month',
      period: monthPeriod,
      value: 0,
      meta: { missingInputs: [...missingInputs].sort(), completeness: completeness },
    });
  }

  return points;
}
