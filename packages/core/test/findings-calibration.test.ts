import { describe, expect, it } from 'vitest';
import { calibrateThresholds, type CalibrationInput } from '../src/index';

// Two tenants, same rule set, different margin structures. All expected values
// are hand-calculated from the fixtures below and asserted directly.

// Tenant A — 70% contribution margin, ~$11k/mo spend.
//   breakEvenRoas = 1/0.70 = 1.428571… → 1.4286
//   medianSpend = median(1,000,000; 1,200,000; 1,100,000) = 1,100,000
//   minImpact = max(5,000, 1% of 1,100,000 = 11,000) = 11,000
//   deadCampaignFloor = max(10,000, 2% of 1,100,000 = 22,000) = 22,000
//   cac = [4000,4200,4400] → mean 4200, sd 200 → ceiling 4400
//   claimGapTol = mean(0.3,0.2,0.35,0.25,0.32,0.22)=0.27333 + sd 0.05922 = 0.33255 → 0.3326
//   discountLeakageCeil = max(0.02, sd(0.05,0.06,0.055)=0.005) = 0.02
const tenantA: CalibrationInput = {
  currency: 'USD',
  months: [
    {
      period: '2026-06-01',
      contributionMarginRate: 0.7,
      breakEvenRoas: 1 / 0.7,
      totalAdSpendMinor: 1_000_000,
      blendedCacMinor: 4000,
      discountShare: 0.05,
      claimGaps: [0.3, 0.2],
    },
    {
      period: '2026-07-01',
      contributionMarginRate: 0.7,
      breakEvenRoas: 1 / 0.7,
      totalAdSpendMinor: 1_200_000,
      blendedCacMinor: 4200,
      discountShare: 0.06,
      claimGaps: [0.35, 0.25],
    },
    {
      period: '2026-08-01',
      contributionMarginRate: 0.7,
      breakEvenRoas: 1 / 0.7,
      totalAdSpendMinor: 1_100_000,
      blendedCacMinor: 4400,
      discountShare: 0.055,
      claimGaps: [0.32, 0.22],
    },
  ],
};

// Tenant B — 30% contribution margin, ~$2.2k/mo spend.
//   breakEvenRoas = 1/0.30 = 3.333333… → 3.3333
//   medianSpend = median(200,000; 250,000; 220,000) = 220,000
//   minImpact = max(5,000, 1% of 220,000 = 2,200) = 5,000  (floor wins)
//   deadCampaignFloor = max(10,000, 2% of 220,000 = 4,400) = 10,000  (floor wins)
//   cac = [8000,8500,9000] → mean 8500, sd 500 → ceiling 9000
//   claimGapTol = mean(0.5,0.45,0.55,0.48,0.52,0.46)=0.49333 + sd 0.03777 = 0.53110 → 0.5311
const tenantB: CalibrationInput = {
  currency: 'USD',
  months: [
    {
      period: '2026-06-01',
      contributionMarginRate: 0.3,
      breakEvenRoas: 1 / 0.3,
      totalAdSpendMinor: 200_000,
      blendedCacMinor: 8000,
      discountShare: 0.12,
      claimGaps: [0.5, 0.45],
    },
    {
      period: '2026-07-01',
      contributionMarginRate: 0.3,
      breakEvenRoas: 1 / 0.3,
      totalAdSpendMinor: 250_000,
      blendedCacMinor: 8500,
      discountShare: 0.13,
      claimGaps: [0.55, 0.48],
    },
    {
      period: '2026-08-01',
      contributionMarginRate: 0.3,
      breakEvenRoas: 1 / 0.3,
      totalAdSpendMinor: 220_000,
      blendedCacMinor: 9000,
      discountShare: 0.125,
      claimGaps: [0.52, 0.46],
    },
  ],
};

describe('per-tenant threshold calibration', () => {
  it('derives tenant A thresholds from its own history and margin', () => {
    const t = calibrateThresholds(tenantA);
    expect(t.breakEvenMer).toBe(1.4286);
    expect(t.minImpactMinor).toBe(11_000);
    expect(t.deadCampaignSpendFloorMinor).toBe(22_000);
    expect(t.cacCeilingMinor).toBe(4400);
    expect(t.claimGapTolerance).toBeCloseTo(0.3326, 4);
    expect(t.discountLeakageDeltaCeil).toBe(0.02);
  });

  it('derives different tenant B thresholds from the same rule set', () => {
    const t = calibrateThresholds(tenantB);
    expect(t.breakEvenMer).toBe(3.3333);
    expect(t.minImpactMinor).toBe(5000);
    expect(t.deadCampaignSpendFloorMinor).toBe(10_000);
    expect(t.cacCeilingMinor).toBe(9000);
    expect(t.claimGapTolerance).toBeCloseTo(0.5311, 4);
    expect(t.discountLeakageDeltaCeil).toBe(0.02);
  });

  it('produces different break-even MER for different margins', () => {
    const a = calibrateThresholds(tenantA);
    const b = calibrateThresholds(tenantB);
    // Higher margin → lower break-even MER.
    expect(a.breakEvenMer!).toBeLessThan(b.breakEvenMer!);
  });

  it('a threshold change alters which findings fire', () => {
    // The below-break-even-MER gate: fires when actual MER < break-even MER.
    const actualMer = 2.0;
    const fires = (t: ReturnType<typeof calibrateThresholds>): boolean =>
      t.breakEvenMer !== null && actualMer < t.breakEvenMer;
    // Same account-wide MER of 2.0: fires for the low-margin tenant (break-even
    // 3.33), does not fire for the high-margin tenant (break-even 1.43).
    expect(fires(calibrateThresholds(tenantA))).toBe(false);
    expect(fires(calibrateThresholds(tenantB))).toBe(true);
  });

  it('returns a null break-even MER when there is no margin data', () => {
    const t = calibrateThresholds({
      currency: 'USD',
      months: [
        {
          period: '2026-08-01',
          contributionMarginRate: null,
          breakEvenRoas: null,
          totalAdSpendMinor: 500_000,
          blendedCacMinor: null,
          discountShare: null,
          claimGaps: [],
        },
      ],
    });
    expect(t.breakEvenMer).toBeNull();
    expect(t.cacCeilingMinor).toBeNull();
    expect(t.claimGapTolerance).toBe(0.3); // default when no history
  });
});
