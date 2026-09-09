import { describe, expect, it } from 'vitest';
import {
  rankAndSuppress,
  nothingNeedsChanging,
  type FindingDraft,
  type FindingThresholds,
} from '../src/index';

const thresholds: FindingThresholds = {
  breakEvenMer: 2,
  minImpactMinor: 10_000, // $100 floor
  deadCampaignSpendFloorMinor: 50_000,
  brandedShareCeil: 0.35,
  refundRateMultiple: 2,
  discountLeakageDeltaCeil: 0.03,
  claimGapTolerance: 0.3,
  cacCeilingMinor: 5_000,
  pacingOveragePct: 0.1,
  searchTermWasteFloorMinor: 10_000,
};

function draft(ruleId: string, impact: number, entityKey = ruleId): FindingDraft {
  return {
    ruleId,
    severity: 'attention',
    metric: 'x',
    currentValue: null,
    comparisonValue: null,
    delta: null,
    entity: 'account',
    entityKey,
    entityLabel: entityKey,
    family: 'waste',
    moneyImpactMinor: impact,
    opportunityValueMinor: null,
    currency: 'USD',
    evidence: {},
    checkMetric: null,
    checkBaseline: null,
  };
}

/** A growth finding: no money impact, a hypothetical opportunity value instead. */
function growthDraft(ruleId: string, opportunity: number, entityKey = ruleId): FindingDraft {
  return {
    ...draft(ruleId, 0, entityKey),
    family: 'growth',
    moneyImpactMinor: 0,
    opportunityValueMinor: opportunity,
  };
}

describe('ranking and suppression', () => {
  it('sorts by money impact, caps actionable output at three, records the rest', () => {
    const findings = [
      draft('r1', 500_000),
      draft('r2', 400_000),
      draft('r3', 300_000),
      draft('r4', 200_000), // over the cap
      draft('r5', 5_000), // below the floor
    ];
    const ranked = rankAndSuppress(findings, thresholds);
    const kept = ranked.filter((f) => !f.suppressed).map((f) => f.ruleId);
    expect(kept).toEqual(['r1', 'r2', 'r3']);
    const overCap = ranked.find((f) => f.ruleId === 'r4');
    expect(overCap).toMatchObject({ suppressed: true, suppressedReason: 'over the three-per-period cap' });
    const belowFloor = ranked.find((f) => f.ruleId === 'r5');
    expect(belowFloor).toMatchObject({ suppressed: true, suppressedReason: 'below the minimum impact threshold' });
    // Every finding is recorded, not discarded.
    expect(ranked).toHaveLength(5);
  });

  it('keeps claim-gap findings regardless of floor and cap', () => {
    const findings = [
      draft('r1', 500_000),
      draft('r2', 400_000),
      draft('r3', 300_000),
      draft('claim_gap', 0, 'claim:google_ads'),
    ];
    const ranked = rankAndSuppress(findings, thresholds);
    const claim = ranked.find((f) => f.ruleId === 'claim_gap');
    // Impact 0 is below the floor and there are already 3 actionable, but it
    // is exempt on both counts.
    expect(claim).toMatchObject({ suppressed: false });
    expect(ranked.filter((f) => !f.suppressed && f.ruleId !== 'claim_gap')).toHaveLength(3);
  });

  it('reports nothing-needs-changing when only measurement risk or suppressed remain', () => {
    const onlyClaim = rankAndSuppress([draft('claim_gap', 0, 'claim:meta')], thresholds);
    expect(nothingNeedsChanging(onlyClaim)).toBe(true);

    const onlyBelowFloor = rankAndSuppress([draft('r1', 5_000)], thresholds);
    expect(nothingNeedsChanging(onlyBelowFloor)).toBe(true);

    const hasActionable = rankAndSuppress([draft('r1', 500_000)], thresholds);
    expect(nothingNeedsChanging(hasActionable)).toBe(false);

    expect(nothingNeedsChanging(rankAndSuppress([], thresholds))).toBe(true);
  });
});

describe('ranking across families (task 5.A2)', () => {
  it('surfaces waste-only findings unchanged, ranked by money impact', () => {
    const ranked = rankAndSuppress([draft('w1', 300_000), draft('w2', 200_000)], thresholds);
    expect(ranked.filter((f) => !f.suppressed).map((f) => f.ruleId)).toEqual(['w1', 'w2']);
  });

  it('suppresses growth findings entirely when no waste finding fires', () => {
    // A lone growth opportunity of $3,000, well above the $100 floor, but with
    // no waste finding this period → suppressed. A report is never only growth.
    const ranked = rankAndSuppress([growthDraft('spend_headroom', 300_000)], thresholds);
    const g = ranked.find((f) => f.ruleId === 'spend_headroom');
    expect(g).toMatchObject({
      suppressed: true,
      suppressedReason: 'no waste finding this period — growth is suppressed',
    });
    expect(nothingNeedsChanging(ranked)).toBe(true);
  });

  it('ranks across both value fields in one list, waste above growth at equal value', () => {
    // Values: waste 500k, growth 400k, waste 300k → order 500k, 400k, 300k.
    const mixed = rankAndSuppress(
      [draft('w_hi', 500_000), growthDraft('g_mid', 400_000), draft('w_lo', 300_000)],
      thresholds,
    );
    expect(mixed.filter((f) => !f.suppressed).map((f) => f.ruleId)).toEqual([
      'w_hi',
      'g_mid',
      'w_lo',
    ]);

    // Equal value (200k each) → the waste finding ranks above the growth one.
    const tie = rankAndSuppress(
      [growthDraft('g_eq', 200_000), draft('w_eq', 200_000)],
      thresholds,
    );
    expect(tie.filter((f) => !f.suppressed).map((f) => f.ruleId)).toEqual(['w_eq', 'g_eq']);
  });

  it('surfaces at most one growth finding per report', () => {
    // A waste finding fires, so growth is eligible — but only the top growth is
    // surfaced; the second is suppressed on the one-growth cap.
    const ranked = rankAndSuppress(
      [draft('w1', 600_000), growthDraft('g1', 400_000), growthDraft('g2', 300_000)],
      thresholds,
    );
    expect(ranked.filter((f) => !f.suppressed).map((f) => f.ruleId)).toEqual(['w1', 'g1']);
    expect(ranked.find((f) => f.ruleId === 'g2')).toMatchObject({
      suppressed: true,
      suppressedReason: 'over the one-growth-per-report cap',
    });
  });

  it('growth yields to waste under the three-per-period cap', () => {
    // Three waste findings fill the cap; the growth finding is squeezed out even
    // though a waste finding fired (so it was eligible).
    const ranked = rankAndSuppress(
      [
        draft('w1', 500_000),
        draft('w2', 400_000),
        draft('w3', 300_000),
        growthDraft('g1', 250_000),
      ],
      thresholds,
    );
    expect(ranked.filter((f) => !f.suppressed).map((f) => f.ruleId)).toEqual(['w1', 'w2', 'w3']);
    expect(ranked.find((f) => f.ruleId === 'g1')).toMatchObject({
      suppressed: true,
      suppressedReason: 'over the three-per-period cap',
    });
  });
});
