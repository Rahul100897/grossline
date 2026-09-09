import { describe, expect, it } from 'vitest';
import {
  RULES,
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
  type FindingsInput,
  type FindingThresholds,
  type RuleOutcome,
} from '../src/index';

const thresholds: FindingThresholds = {
  breakEvenMer: 2.0,
  minImpactMinor: 10_000,
  deadCampaignSpendFloorMinor: 50_000,
  brandedShareCeil: 0.35,
  refundRateMultiple: 2,
  discountLeakageDeltaCeil: 0.03,
  claimGapTolerance: 0.3,
  cacCeilingMinor: 5_000,
  pacingOveragePct: 0.1,
  searchTermWasteFloorMinor: 10_000,
};

// A base input with everything present and healthy; each test overrides the
// slice its rule reads.
function base(over: Partial<FindingsInput> = {}): FindingsInput {
  return {
    period: '2026-07-01',
    currency: 'USD',
    account: {
      currency: 'USD',
      merValue: 2.5,
      netSalesMinor: 2_500_000,
      totalAdSpendMinor: 1_000_000,
      grossSalesMinor: 1_000_000,
      discountsMinor: 70_000,
      blendedCacMinor: 4_000,
      firstOrderContributionMinor: 5_000,
      newCustomerCount: 100,
      refundRate: 0.05,
      spendMonthToDateMinor: 500_000,
      spendProjectedMonthEndMinor: 540_000,
    },
    priorDiscountShare: 0.05,
    campaigns: [],
    searchTerms: [],
    productRefunds: [],
    channelClaims: [],
    monthlySpendTargetMinor: 500_000,
    thresholds,
    availability: {
      hasMargin: true,
      hasGoogle: true,
      hasMeta: true,
      hasCampaignAttribution: true,
      hasBrandedClassification: true,
      hasSearchTerms: true,
      hasProductRefunds: true,
      hasSpendTarget: true,
    },
    ...over,
  };
}

function fired(outcomes: RuleOutcome[]) {
  return outcomes.filter((o) => o.status === 'fired').map((o) => (o as { finding: unknown }).finding);
}

describe('rule: below break-even MER', () => {
  it('fires with (break-even − actual) × spend', () => {
    // mer 1.5 < 2.0, spend 1,000,000 → (2.0−1.5)×1,000,000 = 500,000.
    const out = belowBreakEvenMer.run(base({ account: { ...base().account, merValue: 1.5 } }));
    const f = fired(out);
    expect(f).toHaveLength(1);
    expect(f[0]).toMatchObject({ moneyImpactMinor: 500_000, currentValue: 1.5, comparisonValue: 2.0, delta: -0.5, severity: 'critical' });
  });
  it('is ok when MER is above break-even', () => {
    expect(belowBreakEvenMer.run(base({ account: { ...base().account, merValue: 2.5 } }))).toEqual([{ status: 'ok' }]);
  });
  it('skips without margin data', () => {
    const out = belowBreakEvenMer.run(base({ availability: { ...base().availability, hasMargin: false }, thresholds: { ...thresholds, breakEvenMer: null } }));
    expect(out[0]!.status).toBe('skipped');
  });
});

describe('rule: dead campaign', () => {
  const campaigns = [
    { key: 'campaign:google_ads:1', label: 'PMax', platform: 'google_ads', spendMinor: 420_000, attributedOrders: 3, isBranded: false, roas: null },
    { key: 'campaign:google_ads:2', label: 'Prospecting', platform: 'google_ads', spendMinor: 60_000, attributedOrders: 0, isBranded: false, roas: null },
  ];
  it('fires full spend for a campaign over the floor with zero orders', () => {
    const f = fired(deadCampaign.run(base({ campaigns })));
    expect(f).toHaveLength(1);
    expect(f[0]).toMatchObject({ entityKey: 'campaign:google_ads:2', moneyImpactMinor: 60_000, severity: 'attention' });
  });
  it('is ok when every campaign has orders', () => {
    const ok = deadCampaign.run(base({ campaigns: campaigns.map((c) => ({ ...c, attributedOrders: 5 })) }));
    expect(ok).toEqual([{ status: 'ok' }]);
  });
  it('skips without per-campaign attribution', () => {
    expect(deadCampaign.run(base({ availability: { ...base().availability, hasCampaignAttribution: false } }))[0]!.status).toBe('skipped');
  });
});

describe('rule: branded search share', () => {
  const campaigns = [
    { key: 'g:brand', label: 'Brand', platform: 'google_ads', spendMinor: 400_000, attributedOrders: 50, isBranded: true, roas: null },
    { key: 'g:generic', label: 'Generic', platform: 'google_ads', spendMinor: 600_000, attributedOrders: 40, isBranded: false, roas: null },
  ];
  it('fires branded spend when share exceeds the ceiling', () => {
    // 400,000 / 1,000,000 = 0.40 > 0.35.
    const f = fired(brandedSearchShare.run(base({ campaigns })));
    expect(f[0]).toMatchObject({ moneyImpactMinor: 400_000, currentValue: 0.4, comparisonValue: 0.35 });
  });
  it('is ok at or below the ceiling', () => {
    const c = [{ ...campaigns[0]!, spendMinor: 300_000 }, campaigns[1]!]; // 300k/900k = 0.333
    expect(brandedSearchShare.run(base({ campaigns: c }))).toEqual([{ status: 'ok' }]);
  });
  it('skips when branded keywords are not identifiable', () => {
    expect(brandedSearchShare.run(base({ availability: { ...base().availability, hasBrandedClassification: false } }))[0]!.status).toBe('skipped');
  });
});

describe('rule: search term waste', () => {
  const terms = [
    { key: 't1', label: 'cheap widget', costMinor: 12_000, conversions: 0 },
    { key: 't2', label: 'widget review', costMinor: 5_000, conversions: 2 },
    { key: 't3', label: 'free widget', costMinor: 3_000, conversions: 0 },
  ];
  it('sums the cost of zero-conversion terms', () => {
    // 12,000 + 3,000 = 15,000 ≥ 10,000 floor.
    const f = fired(searchTermWaste.run(base({ searchTerms: terms })));
    expect(f[0]).toMatchObject({ moneyImpactMinor: 15_000 });
    expect((f[0] as { evidence: { termCount: number } }).evidence.termCount).toBe(2);
  });
  it('is ok below the waste floor', () => {
    const t = [{ key: 't', label: 'x', costMinor: 8_000, conversions: 0 }];
    expect(searchTermWaste.run(base({ searchTerms: t }))).toEqual([{ status: 'ok' }]);
  });
  it('skips without a search-term report', () => {
    expect(searchTermWaste.run(base({ availability: { ...base().availability, hasSearchTerms: false } }))[0]!.status).toBe('skipped');
  });
});

describe('rule: discount leakage', () => {
  it('fires the absolute rise when discount share climbs beyond tolerance', () => {
    // discounts 90,000 / gross 1,000,000 = 0.09; prior 0.05; delta 0.04 > 0.03.
    // impact = 0.04 × 1,000,000 = 40,000.
    const out = discountLeakage.run(base({ account: { ...base().account, discountsMinor: 90_000 }, priorDiscountShare: 0.05 }));
    const f = fired(out);
    expect(f[0]).toMatchObject({ moneyImpactMinor: 40_000, currentValue: 0.09, comparisonValue: 0.05 });
  });
  it('is ok within tolerance', () => {
    expect(discountLeakage.run(base({ account: { ...base().account, discountsMinor: 70_000 }, priorDiscountShare: 0.05 }))).toEqual([{ status: 'ok' }]);
  });
  it('skips without a prior period', () => {
    expect(discountLeakage.run(base({ priorDiscountShare: null }))[0]!.status).toBe('skipped');
  });
});

describe('rule: refund outlier', () => {
  const products = [
    { key: 'P1', label: 'Serum', refundRate: 0.15, refundedValueMinor: 30_000, attributedSpendMinor: 20_000 },
    { key: 'P2', label: 'Cream', refundRate: 0.08, refundedValueMinor: 5_000, attributedSpendMinor: 10_000 },
  ];
  it('fires refunded value + spend for a product above 2× store average that receives spend', () => {
    // store avg 0.05 × 2 = 0.10; P1 0.15 > 0.10, receives spend → 30,000 + 20,000 = 50,000.
    const f = fired(refundOutlier.run(base({ productRefunds: products })));
    expect(f).toHaveLength(1);
    expect(f[0]).toMatchObject({ entityKey: 'P1', moneyImpactMinor: 50_000 });
  });
  it('is ok when no product exceeds the multiple', () => {
    expect(refundOutlier.run(base({ productRefunds: [products[1]!] }))).toEqual([{ status: 'ok' }]);
  });
  it('skips without per-product refund data', () => {
    expect(refundOutlier.run(base({ availability: { ...base().availability, hasProductRefunds: false } }))[0]!.status).toBe('skipped');
  });
});

describe('rule: payback broken', () => {
  it('fires CAC gap × new customers', () => {
    // CAC 8,000 > contribution 5,000; gap 3,000 × 100 = 300,000.
    const out = paybackBroken.run(base({ account: { ...base().account, blendedCacMinor: 8_000 } }));
    expect(fired(out)[0]).toMatchObject({ moneyImpactMinor: 300_000, currentValue: 8_000, comparisonValue: 5_000 });
  });
  it('is ok when acquisition pays back on the first order', () => {
    expect(paybackBroken.run(base({ account: { ...base().account, blendedCacMinor: 4_000 } }))).toEqual([{ status: 'ok' }]);
  });
  it('skips without margin (no first-order contribution)', () => {
    expect(paybackBroken.run(base({ availability: { ...base().availability, hasMargin: false }, account: { ...base().account, firstOrderContributionMinor: null } }))[0]!.status).toBe('skipped');
  });
});

describe('rule: claim gap', () => {
  const claims = [
    { platform: 'google_ads', label: 'Google', claimGap: 0.45, platformConversions: 100, storeOrders: 55, spendMinor: 400_000 },
    { platform: 'meta', label: 'Meta', claimGap: 0.2, platformConversions: 80, storeOrders: 64, spendMinor: 300_000 },
  ];
  it('flags a measurement risk with zero money impact', () => {
    const f = fired(claimGap.run(base({ channelClaims: claims })));
    expect(f).toHaveLength(1);
    expect(f[0]).toMatchObject({ entityKey: 'claim:google_ads', moneyImpactMinor: 0, severity: 'info' });
  });
  it('is ok within tolerance', () => {
    expect(claimGap.run(base({ channelClaims: [claims[1]!] }))).toEqual([{ status: 'ok' }]);
  });
  it('skips without claim data', () => {
    expect(claimGap.run(base({ channelClaims: [] }))[0]!.status).toBe('skipped');
  });
});

describe('rule: spend pacing', () => {
  it('fires the overspend above target', () => {
    // target 500,000; ceiling 550,000; projected 620,000 → impact 620,000 − 500,000 = 120,000.
    const out = spendPacing.run(base({ account: { ...base().account, spendProjectedMonthEndMinor: 620_000 } }));
    expect(fired(out)[0]).toMatchObject({ moneyImpactMinor: 120_000, currentValue: 620_000, comparisonValue: 500_000 });
  });
  it('is ok within the pacing ceiling', () => {
    expect(spendPacing.run(base({ account: { ...base().account, spendProjectedMonthEndMinor: 540_000 } }))).toEqual([{ status: 'ok' }]);
  });
  it('skips without a spend target', () => {
    expect(spendPacing.run(base({ availability: { ...base().availability, hasSpendTarget: false }, monthlySpendTargetMinor: null }))[0]!.status).toBe('skipped');
  });
});

describe('no rule fires on incomplete data', () => {
  it('every rule skips when all inputs are absent', () => {
    const empty: FindingsInput = {
      period: '2026-07-01',
      currency: 'USD',
      account: {
        currency: 'USD',
        merValue: null,
        netSalesMinor: null,
        totalAdSpendMinor: null,
        grossSalesMinor: null,
        discountsMinor: null,
        blendedCacMinor: null,
        firstOrderContributionMinor: null,
        newCustomerCount: null,
        refundRate: null,
        spendMonthToDateMinor: null,
        spendProjectedMonthEndMinor: null,
      },
      priorDiscountShare: null,
      campaigns: [],
      searchTerms: [],
      productRefunds: [],
      channelClaims: [],
      monthlySpendTargetMinor: null,
      thresholds: { ...thresholds, breakEvenMer: null, cacCeilingMinor: null },
      availability: {
        hasMargin: false,
        hasGoogle: false,
        hasMeta: false,
        hasCampaignAttribution: false,
        hasBrandedClassification: false,
        hasSearchTerms: false,
        hasProductRefunds: false,
        hasSpendTarget: false,
      },
    };
    for (const rule of RULES) {
      const out = rule.run(empty);
      expect(out.every((o) => o.status === 'skipped'), `${rule.id} must skip on absent data`).toBe(true);
      expect(out.some((o) => o.status === 'fired'), `${rule.id} must not fire on absent data`).toBe(false);
    }
  });
});

describe('rule: spend headroom (growth)', () => {
  it('fires with spend × (MER ÷ break-even − 1) when comfortably above break-even', () => {
    // mer 3.0 ≥ break-even 2.0 × 1.2 = 2.4; spend 1,000,000 →
    // 1,000,000 × (3.0/2.0 − 1) = 1,000,000 × 0.5 = 500,000 opportunity.
    // Not pacing over: projected 540,000 ≤ target 500,000 × 1.1 = 550,000.
    const out = spendHeadroom.run(base({ account: { ...base().account, merValue: 3.0 } }));
    const f = fired(out);
    expect(f).toHaveLength(1);
    expect(f[0]).toMatchObject({
      ruleId: 'spend_headroom',
      family: 'growth',
      moneyImpactMinor: 0,
      opportunityValueMinor: 500_000,
      currentValue: 3.0,
      comparisonValue: 2.0,
      checkMetric: 'mer',
      checkBaseline: 3.0,
    });
  });

  it('does not fire at (or near) break-even — evaluated, no opportunity', () => {
    // mer 2.1 is above break-even 2.0 but below the 2.4 safety margin → ok().
    const out = spendHeadroom.run(base({ account: { ...base().account, merValue: 2.1 } }));
    expect(out).toEqual([{ status: 'ok' }]);
  });

  it('does not fire when spend is already pacing over target', () => {
    // Comfortably above break-even (mer 3.0) but projected 600,000 > 550,000
    // ceiling → the pacing rule owns this; headroom stays quiet.
    const out = spendHeadroom.run(
      base({
        account: { ...base().account, merValue: 3.0, spendProjectedMonthEndMinor: 600_000 },
      }),
    );
    expect(out).toEqual([{ status: 'ok' }]);
  });

  it('skips when cost data is incomplete', () => {
    const out = spendHeadroom.run(
      base({
        availability: { ...base().availability, hasMargin: false },
        thresholds: { ...thresholds, breakEvenMer: null },
      }),
    );
    expect(out).toHaveLength(1);
    expect(out[0]!.status).toBe('skipped');
  });
});

describe('rule: scale signal (growth)', () => {
  // Spend-weighted average ROAS = total conversion value ÷ total spend.
  // A/B: 80,000 spend @ 2.0 → 160,000 each; C: 40,000 spend @ 7.0 → 280,000.
  // total spend 200,000, total value 600,000 → average ROAS 3.0.
  const campaigns = [
    { key: 'campaign:meta:a', label: 'Meta A', platform: 'meta', spendMinor: 80_000, attributedOrders: null, isBranded: null, roas: 2.0 },
    { key: 'campaign:meta:b', label: 'Meta B', platform: 'meta', spendMinor: 80_000, attributedOrders: null, isBranded: null, roas: 2.0 },
    { key: 'campaign:meta:c', label: 'Meta C', platform: 'meta', spendMinor: 40_000, attributedOrders: null, isBranded: null, roas: 7.0 },
  ];

  it('fires on a small-share outperformer with a conservative opportunity', () => {
    // C: ROAS 7.0 ≥ average 3.0 × 1.5 = 4.5, share 40,000/200,000 = 0.20 ≤ 0.25.
    // share shift = 40,000 × 0.25 = 10,000; opportunity = 10,000 × (7.0 − 3.0)
    // = 40,000 (the revenue *difference*, not 7.0 applied to more budget).
    const f = fired(scaleSignal.run(base({ campaigns })));
    expect(f).toHaveLength(1);
    expect(f[0]).toMatchObject({
      ruleId: 'scale_signal',
      family: 'growth',
      entityKey: 'campaign:meta:c',
      moneyImpactMinor: 0,
      opportunityValueMinor: 40_000,
      currentValue: 7.0,
      comparisonValue: 3.0,
      checkMetric: 'platform_roas',
    });
    expect((f[0] as { evidence: Record<string, unknown> }).evidence).toMatchObject({
      platformReported: true,
      accountAvgRoas: 3.0,
    });
  });

  it('is ok when no campaign clearly outperforms the average', () => {
    // 100k each at 2.0/2.0/2.5 → average ≈ 2.167; 2.5 < 1.5 × 2.167 = 3.25.
    const flat = [
      { ...campaigns[0]!, spendMinor: 100_000, roas: 2.0 },
      { ...campaigns[1]!, spendMinor: 100_000, roas: 2.0 },
      { ...campaigns[2]!, spendMinor: 100_000, roas: 2.5 },
    ];
    expect(scaleSignal.run(base({ campaigns: flat }))).toEqual([{ status: 'ok' }]);
  });

  it('does not reward an outperformer that already holds a large share of spend', () => {
    // C outperforms (ROAS 7.0) but takes 60% of spend → not a small-share signal.
    const bigShare = [
      { ...campaigns[0]!, spendMinor: 40_000, roas: 2.0 },
      { ...campaigns[1]!, spendMinor: 40_000, roas: 2.0 },
      { ...campaigns[2]!, spendMinor: 120_000, roas: 7.0 },
    ];
    expect(scaleSignal.run(base({ campaigns: bigShare }))).toEqual([{ status: 'ok' }]);
  });

  it('skips when no campaign-level ROAS is available', () => {
    expect(scaleSignal.run(base({ campaigns: [] }))[0]!.status).toBe('skipped');
    const noRoas = campaigns.map((c) => ({ ...c, roas: null }));
    expect(scaleSignal.run(base({ campaigns: noRoas }))[0]!.status).toBe('skipped');
  });

  it('skips with too few campaigns to compare', () => {
    expect(scaleSignal.run(base({ campaigns: campaigns.slice(0, 2) }))[0]!.status).toBe('skipped');
  });
});

describe('nothing needs changing', () => {
  it('a healthy account fires no waste finding — only the growth headroom opportunity', () => {
    // A robustly healthy account (mer 3.0) surfaces nothing wrong; the only rule
    // that fires is the growth headroom opportunity, which ranking then
    // suppresses when no waste finding accompanies it (findings-ranking.test.ts).
    const healthy = base({ account: { ...base().account, merValue: 3.0 } });
    const firedRuleIds = RULES.flatMap((r) =>
      r.run(healthy).flatMap((o) => (o.status === 'fired' ? [r.id] : [])),
    );
    expect(firedRuleIds).toEqual(['spend_headroom']);
  });
});
