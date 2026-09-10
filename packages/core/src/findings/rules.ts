// The rules library (docs/phase-4.md task 4.3). Each rule is a pure function:
// metrics + thresholds in, finding record or null out. Money impact is an
// integer minor-unit figure and the sort key. A rule that needs data the tenant
// does not have returns a single `skipped` with a reason — never a finding
// built on absent inputs. Every rule is golden-tested with hand-calculated
// values.
import type { Evidence, FindingDraft, FindingFamily, FindingSeverity, RuleOutcome } from './types';
import type { Rule } from './rule-types';

const skip = (reason: string): RuleOutcome[] => [{ status: 'skipped', reason }];
const ok = (): RuleOutcome[] => [{ status: 'ok' }];
const round4 = (v: number): number => Math.round(v * 10_000) / 10_000;

function severityForImpact(impactMinor: number, minImpactMinor: number): FindingSeverity {
  if (impactMinor >= minImpactMinor * 10) return 'critical';
  if (impactMinor >= minImpactMinor) return 'attention';
  return 'info';
}

function finding(f: {
  ruleId: string;
  severity: FindingSeverity;
  metric: string;
  currentValue: number | null;
  comparisonValue: number | null;
  entity: FindingDraft['entity'];
  entityKey: string;
  entityLabel: string;
  moneyImpactMinor: number;
  currency: string | null;
  evidence: Evidence;
  checkMetric: string | null;
  checkBaseline: number | null;
  /** Defaults to 'waste'; growth rules pass 'growth', claim gap 'measurement'. */
  family?: FindingFamily;
  /** Growth findings carry this instead of a money_impact (which stays 0). */
  opportunityValueMinor?: number | null;
}): RuleOutcome {
  const delta =
    f.currentValue !== null && f.comparisonValue !== null
      ? f.currentValue - f.comparisonValue
      : null;
  return {
    status: 'fired',
    finding: {
      ...f,
      family: f.family ?? 'waste',
      opportunityValueMinor: f.opportunityValueMinor ?? null,
      delta,
    },
  };
}

// ---- 1. Below break-even MER ------------------------------------------------
export const belowBreakEvenMer: Rule = {
  id: 'below_break_even_mer',
  title: 'Below break-even MER',
  run(input) {
    if (!input.availability.hasMargin || input.thresholds.breakEvenMer === null) {
      return skip('no cost inputs — contribution margin and break-even MER are unavailable');
    }
    const { merValue, totalAdSpendMinor } = input.account;
    if (merValue === null || totalAdSpendMinor === null) {
      return skip('MER or total ad spend not computed for the period');
    }
    const breakEven = input.thresholds.breakEvenMer;
    if (merValue >= breakEven) return ok();
    // Spec: money impact = (break-even − actual) × spend.
    const impact = Math.round((breakEven - merValue) * totalAdSpendMinor);
    return [
      finding({
        ruleId: this.id,
        severity: severityForImpact(impact, input.thresholds.minImpactMinor),
        metric: 'mer',
        currentValue: merValue,
        comparisonValue: breakEven,
        entity: 'account',
        entityKey: 'account',
        entityLabel: 'Whole account',
        moneyImpactMinor: impact,
        currency: input.currency,
        evidence: { mer: merValue, breakEvenMer: breakEven, totalAdSpendMinor },
        checkMetric: 'mer',
        checkBaseline: merValue,
      }),
    ];
  },
};

// ---- 2. Dead campaign -------------------------------------------------------
export const deadCampaign: Rule = {
  id: 'dead_campaign',
  title: 'Dead campaign',
  run(input) {
    if (!input.availability.hasGoogle && !input.availability.hasMeta) {
      return skip('no ad platform connected');
    }
    if (!input.availability.hasCampaignAttribution) {
      return skip('no per-campaign order attribution available');
    }
    const floor = input.thresholds.deadCampaignSpendFloorMinor;
    const outcomes: RuleOutcome[] = [];
    for (const c of input.campaigns) {
      if (c.attributedOrders === null) continue;
      if (c.spendMinor >= floor && c.attributedOrders === 0) {
        outcomes.push(
          finding({
            ruleId: this.id,
            severity: severityForImpact(c.spendMinor, input.thresholds.minImpactMinor),
            metric: 'ad_spend',
            currentValue: c.attributedOrders,
            comparisonValue: 0,
            entity: 'campaign',
            entityKey: c.key,
            entityLabel: c.label,
            moneyImpactMinor: c.spendMinor, // full spend
            currency: input.currency,
            evidence: {
              spendMinor: c.spendMinor,
              attributedOrders: 0,
              platform: c.platform,
              floorMinor: floor,
            },
            checkMetric: 'ad_spend',
            checkBaseline: c.spendMinor,
          }),
        );
      }
    }
    return outcomes.length > 0 ? outcomes : ok();
  },
};

// ---- 3. Branded search share ------------------------------------------------
export const brandedSearchShare: Rule = {
  id: 'branded_search_share',
  title: 'Branded search share',
  run(input) {
    if (!input.availability.hasGoogle) return skip('no Google Ads connection');
    if (!input.availability.hasBrandedClassification) {
      return skip('branded keywords are not identifiable for this account');
    }
    const google = input.campaigns.filter((c) => c.platform === 'google_ads');
    const total = google.reduce((s, c) => s + c.spendMinor, 0);
    if (total === 0) return ok();
    const brandedSpend = google
      .filter((c) => c.isBranded === true)
      .reduce((s, c) => s + c.spendMinor, 0);
    const share = brandedSpend / total;
    if (share <= input.thresholds.brandedShareCeil) return ok();
    return [
      finding({
        ruleId: this.id,
        severity: severityForImpact(brandedSpend, input.thresholds.minImpactMinor),
        metric: 'branded_search_share',
        currentValue: share,
        comparisonValue: input.thresholds.brandedShareCeil,
        entity: 'channel',
        entityKey: 'google:branded',
        entityLabel: 'Branded search',
        moneyImpactMinor: brandedSpend,
        currency: input.currency,
        evidence: {
          brandedSpendMinor: brandedSpend,
          googleSpendMinor: total,
          share,
          ceiling: input.thresholds.brandedShareCeil,
        },
        checkMetric: 'branded_search_share',
        checkBaseline: share,
      }),
    ];
  },
};

// ---- 4. Search term waste ---------------------------------------------------
export const searchTermWaste: Rule = {
  id: 'search_term_waste',
  title: 'Search term waste',
  run(input) {
    if (!input.availability.hasSearchTerms) return skip('no search-term report available');
    const wasteful = input.searchTerms.filter((t) => t.costMinor > 0 && t.conversions === 0);
    const wasted = wasteful.reduce((s, t) => s + t.costMinor, 0);
    if (wasted < input.thresholds.searchTermWasteFloorMinor) return ok();
    return [
      finding({
        ruleId: this.id,
        severity: severityForImpact(wasted, input.thresholds.minImpactMinor),
        metric: 'search_term_cost',
        currentValue: wasted,
        comparisonValue: 0,
        entity: 'channel',
        entityKey: 'google:search-terms',
        entityLabel: 'Search terms with no conversions',
        moneyImpactMinor: wasted,
        currency: input.currency,
        evidence: {
          wastedCostMinor: wasted,
          termCount: wasteful.length,
          terms: wasteful
            .slice(0, 10)
            .map((t) => t.label)
            .join(', '),
        },
        checkMetric: 'search_term_cost',
        checkBaseline: wasted,
      }),
    ];
  },
};

// ---- 5. Discount leakage ----------------------------------------------------
export const discountLeakage: Rule = {
  id: 'discount_leakage',
  title: 'Discount leakage',
  run(input) {
    const { grossSalesMinor, discountsMinor } = input.account;
    if (grossSalesMinor === null || discountsMinor === null || grossSalesMinor === 0) {
      return skip('gross sales or discounts not computed for the period');
    }
    if (input.priorDiscountShare === null)
      return skip('no prior period to compare discount share against');
    const currentShare = discountsMinor / grossSalesMinor;
    const delta = currentShare - input.priorDiscountShare;
    if (delta <= input.thresholds.discountLeakageDeltaCeil) return ok();
    // Spec: the rise, in absolute terms.
    const impact = Math.round(delta * grossSalesMinor);
    return [
      finding({
        ruleId: this.id,
        severity: severityForImpact(impact, input.thresholds.minImpactMinor),
        metric: 'discount_share',
        currentValue: currentShare,
        comparisonValue: input.priorDiscountShare,
        entity: 'account',
        entityKey: 'account',
        entityLabel: 'Whole account',
        moneyImpactMinor: impact,
        currency: input.currency,
        evidence: {
          currentShare,
          priorShare: input.priorDiscountShare,
          deltaShare: delta,
          discountsMinor,
          grossSalesMinor,
        },
        checkMetric: 'discount_share',
        checkBaseline: currentShare,
      }),
    ];
  },
};

// ---- 6. Refund outlier ------------------------------------------------------
export const refundOutlier: Rule = {
  id: 'refund_outlier',
  title: 'Refund outlier',
  run(input) {
    if (!input.availability.hasProductRefunds) return skip('no per-product refund data available');
    if (input.account.refundRate === null) return skip('store-wide refund rate not computed');
    const storeAvg = input.account.refundRate;
    const threshold = storeAvg * input.thresholds.refundRateMultiple;
    const outcomes: RuleOutcome[] = [];
    for (const p of input.productRefunds) {
      const receivingSpend = p.attributedSpendMinor !== null && p.attributedSpendMinor > 0;
      if (p.refundRate > threshold && receivingSpend) {
        const impact = p.refundedValueMinor + (p.attributedSpendMinor ?? 0);
        outcomes.push(
          finding({
            ruleId: this.id,
            severity: severityForImpact(impact, input.thresholds.minImpactMinor),
            metric: 'refund_rate',
            currentValue: p.refundRate,
            comparisonValue: threshold,
            entity: 'product',
            entityKey: p.key,
            entityLabel: p.label,
            moneyImpactMinor: impact,
            currency: input.currency,
            evidence: {
              refundRate: p.refundRate,
              storeAvg,
              multiple: input.thresholds.refundRateMultiple,
              refundedValueMinor: p.refundedValueMinor,
              attributedSpendMinor: p.attributedSpendMinor,
            },
            checkMetric: 'refund_rate',
            checkBaseline: p.refundRate,
          }),
        );
      }
    }
    return outcomes.length > 0 ? outcomes : ok();
  },
};

// ---- 7. Payback broken ------------------------------------------------------
export const paybackBroken: Rule = {
  id: 'payback_broken',
  title: 'Payback broken',
  run(input) {
    const { blendedCacMinor, firstOrderContributionMinor, newCustomerCount } = input.account;
    if (!input.availability.hasMargin || firstOrderContributionMinor === null) {
      return skip('no cost inputs — first-order contribution is unavailable');
    }
    if (blendedCacMinor === null || newCustomerCount === null) {
      return skip('blended CAC or new-customer count not computed');
    }
    if (blendedCacMinor <= firstOrderContributionMinor) return ok();
    // Spec: money impact = CAC gap × new customers.
    const gap = blendedCacMinor - firstOrderContributionMinor;
    const impact = Math.round(gap * newCustomerCount);
    return [
      finding({
        ruleId: this.id,
        severity: severityForImpact(impact, input.thresholds.minImpactMinor),
        metric: 'blended_cac',
        currentValue: blendedCacMinor,
        comparisonValue: firstOrderContributionMinor,
        entity: 'account',
        entityKey: 'account',
        entityLabel: 'Whole account',
        moneyImpactMinor: impact,
        currency: input.currency,
        evidence: {
          blendedCacMinor,
          firstOrderContributionMinor,
          gapMinor: gap,
          newCustomerCount,
        },
        checkMetric: 'blended_cac',
        checkBaseline: blendedCacMinor,
      }),
    ];
  },
};

// ---- 8. Claim gap (measurement risk, no spend action) -----------------------
export const claimGap: Rule = {
  id: 'claim_gap',
  title: 'Claim gap',
  run(input) {
    if (input.channelClaims.length === 0)
      return skip('no platform claim data to compare against UTM attribution');
    const tolerance = input.thresholds.claimGapTolerance;
    const outcomes: RuleOutcome[] = [];
    for (const c of input.channelClaims) {
      if (Math.abs(c.claimGap) > tolerance) {
        outcomes.push(
          finding({
            ruleId: this.id,
            severity: 'info', // measurement risk, never a spend loss
            family: 'measurement',
            metric: 'claim_gap',
            currentValue: c.claimGap,
            comparisonValue: tolerance,
            entity: 'channel',
            entityKey: `claim:${c.platform}`,
            entityLabel: c.label,
            moneyImpactMinor: 0, // no spend action; ranking exempts this rule
            currency: input.currency,
            evidence: {
              claimGap: c.claimGap,
              tolerance,
              platformConversions: c.platformConversions,
              storeOrders: c.storeOrders,
              spendMinor: c.spendMinor,
              measurementRisk: true,
            },
            checkMetric: 'claim_gap',
            checkBaseline: c.claimGap,
          }),
        );
      }
    }
    return outcomes.length > 0 ? outcomes : ok();
  },
};

// ---- 9. Spend pacing --------------------------------------------------------
export const spendPacing: Rule = {
  id: 'spend_pacing',
  title: 'Spend pacing',
  run(input) {
    if (!input.availability.hasSpendTarget || input.monthlySpendTargetMinor === null) {
      return skip('no monthly ad-spend target set');
    }
    const projected = input.account.spendProjectedMonthEndMinor;
    if (projected === null) return skip('projected month-end spend not computed');
    const target = input.monthlySpendTargetMinor;
    const ceiling = Math.round(target * (1 + input.thresholds.pacingOveragePct));
    if (projected <= ceiling) return ok();
    const impact = projected - target;
    return [
      finding({
        ruleId: this.id,
        severity: severityForImpact(impact, input.thresholds.minImpactMinor),
        metric: 'spend_projected_month_end',
        currentValue: projected,
        comparisonValue: target,
        entity: 'account',
        entityKey: 'account',
        entityLabel: 'Whole account',
        moneyImpactMinor: impact,
        currency: input.currency,
        evidence: {
          projectedMinor: projected,
          targetMinor: target,
          ceilingMinor: ceiling,
          overagePct: input.thresholds.pacingOveragePct,
          spendMonthToDateMinor: input.account.spendMonthToDateMinor,
        },
        checkMetric: 'spend_projected_month_end',
        checkBaseline: projected,
      }),
    ];
  },
};

// ---- 10. Spend headroom (growth) --------------------------------------------
// Where should freed budget go? When blended MER sits comfortably above
// break-even and spend is not already pacing over target, there is room to
// deploy more spend while still clearing break-even. The opportunity is
// arithmetic at TODAY's efficiency — and efficiency falls as spend rises, so the
// recommendation is a bounded increase, checked next month against MER and orders.
export const HEADROOM_SAFETY_MARGIN = 0.2; // MER must clear break-even × 1.2

export const spendHeadroom: Rule = {
  id: 'spend_headroom',
  title: 'Spend headroom',
  run(input) {
    if (!input.availability.hasMargin || input.thresholds.breakEvenMer === null) {
      return skip('no cost inputs — contribution margin and break-even MER are unavailable');
    }
    const { merValue, totalAdSpendMinor } = input.account;
    if (merValue === null || totalAdSpendMinor === null || totalAdSpendMinor <= 0) {
      return skip('MER or total ad spend not computed for the period');
    }
    const breakEven = input.thresholds.breakEvenMer;
    // Only when comfortably above break-even, with a margin of safety.
    if (merValue < breakEven * (1 + HEADROOM_SAFETY_MARGIN)) return ok();
    // Not when spend is already pacing over target — the pacing rule owns that,
    // and suggesting more spend there would contradict it.
    if (input.availability.hasSpendTarget && input.monthlySpendTargetMinor !== null) {
      const projected = input.account.spendProjectedMonthEndMinor;
      if (projected !== null) {
        const ceiling = Math.round(
          input.monthlySpendTargetMinor * (1 + input.thresholds.pacingOveragePct),
        );
        if (projected > ceiling) return ok();
      }
    }
    // Opportunity: additional monthly spend deployable while still clearing
    // break-even at today's efficiency = spend × (MER ÷ break-even − 1). This is
    // the current contribution-after-ad-spend surplus expressed as spend room.
    const opportunity = Math.round(totalAdSpendMinor * (merValue / breakEven - 1));
    if (opportunity < input.thresholds.minImpactMinor) return ok(); // too small to surface
    return [
      finding({
        ruleId: this.id,
        severity: 'info', // a growth hypothesis, not an alarm; family ranks it
        family: 'growth',
        metric: 'mer',
        currentValue: merValue,
        comparisonValue: breakEven,
        entity: 'account',
        entityKey: 'account',
        entityLabel: 'Whole account',
        moneyImpactMinor: 0,
        opportunityValueMinor: opportunity,
        currency: input.currency,
        evidence: {
          mer: merValue,
          breakEvenMer: breakEven,
          totalAdSpendMinor,
          headroomMinor: opportunity,
          safetyMargin: HEADROOM_SAFETY_MARGIN,
        },
        checkMetric: 'mer',
        checkBaseline: merValue,
      }),
    ];
  },
};

// ---- 11. Scale signal (growth) ----------------------------------------------
// A campaign whose platform-reported ROAS is materially above the account
// average while holding a small share of platform spend has room to take more
// budget. The opportunity is deliberately CONSERVATIVE — not this campaign's
// ROAS applied to more budget (the exact mistake that loses a client money) but
// the revenue *difference* between the campaign's efficiency and the account
// average, applied to a bounded share shift. ROAS stays labelled
// platform-reported and is never presented as blended.
export const SCALE_OUTPERFORM_MULTIPLE = 1.5; // ROAS ≥ average × 1.5
export const SCALE_SMALL_SHARE = 0.25; // holds ≤ 25% of platform spend
export const SCALE_SHIFT_FRACTION = 0.25; // bounded share shift = 25% of its spend
export const SCALE_MIN_CAMPAIGNS = 3;

export const scaleSignal: Rule = {
  id: 'scale_signal',
  title: 'Scale signal',
  run(input) {
    const withRoas = input.campaigns.filter((c) => c.roas !== null && c.spendMinor > 0);
    if (withRoas.length === 0) return skip('no campaign-level platform ROAS available');
    if (withRoas.length < SCALE_MIN_CAMPAIGNS) {
      return skip('too few campaigns to identify an outperformer');
    }
    const totalSpend = withRoas.reduce((s, c) => s + c.spendMinor, 0);
    if (totalSpend === 0) return skip('no campaign spend to compare against');
    // Spend-weighted account-average ROAS = total conversion value ÷ total spend.
    const avgRoas =
      withRoas.reduce((s, c) => s + (c.roas as number) * c.spendMinor, 0) / totalSpend;
    if (avgRoas <= 0) return ok();

    // Materially above average AND holding a small share of spend.
    const candidates = withRoas.filter(
      (c) =>
        (c.roas as number) >= avgRoas * SCALE_OUTPERFORM_MULTIPLE &&
        c.spendMinor / totalSpend <= SCALE_SMALL_SHARE,
    );
    if (candidates.length === 0) return ok();

    // The single best outperformer by (conservative) opportunity value.
    let best: { c: (typeof candidates)[number]; shareShift: number; opp: number } | null = null;
    for (const c of candidates) {
      const shareShift = Math.round(c.spendMinor * SCALE_SHIFT_FRACTION);
      const opp = Math.round(shareShift * ((c.roas as number) - avgRoas));
      if (best === null || opp > best.opp) best = { c, shareShift, opp };
    }
    if (best === null || best.opp < input.thresholds.minImpactMinor) return ok();

    const { c, shareShift, opp } = best;
    return [
      finding({
        ruleId: this.id,
        severity: 'info', // a growth hypothesis, not an alarm; family ranks it
        family: 'growth',
        metric: 'platform_roas',
        currentValue: c.roas,
        comparisonValue: round4(avgRoas),
        entity: 'campaign',
        entityKey: c.key,
        entityLabel: c.label,
        moneyImpactMinor: 0,
        opportunityValueMinor: opp,
        currency: input.currency,
        evidence: {
          roas: c.roas,
          accountAvgRoas: round4(avgRoas),
          spendShare: round4(c.spendMinor / totalSpend),
          campaignSpendMinor: c.spendMinor,
          shareShiftMinor: shareShift,
          platform: c.platform,
          platformReported: true,
        },
        checkMetric: 'platform_roas',
        checkBaseline: c.roas,
      }),
    ];
  },
};

export const RULES: Rule[] = [
  belowBreakEvenMer,
  deadCampaign,
  brandedSearchShare,
  searchTermWaste,
  discountLeakage,
  refundOutlier,
  paybackBroken,
  claimGap,
  spendPacing,
  spendHeadroom,
  scaleSignal,
];

/** Rules whose findings are exempt from the money-impact suppression floor. */
export const IMPACT_FLOOR_EXEMPT_RULES = new Set<string>(['claim_gap']);
