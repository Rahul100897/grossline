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
