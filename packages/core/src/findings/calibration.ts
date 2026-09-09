// Per-tenant threshold calibration (docs/phase-4.md task 4.2). Pure: the
// tenant's own recent months plus its margin structure in, a threshold record
// out. Break-even MER comes from the actual contribution margin rate; the CAC
// ceiling and claim-gap tolerance from the account's own history, never a fixed
// percentage. Two tenants with different margins produce different thresholds.

/** The finding-rule thresholds, one set per tenant. Money is integer minor units. */
export type FindingThresholds = {
  /** MER below this is below break-even. Null when there is no margin data. */
  breakEvenMer: number | null;
  /** Ranking floor (task 4.4): findings below this money impact are suppressed. */
  minImpactMinor: number;
  /** Dead-campaign rule: campaign spend at or above this with no orders fires. */
  deadCampaignSpendFloorMinor: number;
  /** Branded-search rule: branded share of Google spend above this fires. */
  brandedShareCeil: number;
  /** Refund-outlier rule: product refund rate above this multiple of store average. */
  refundRateMultiple: number;
  /** Discount-leakage rule: discount share rising by more than this (points, 0..1). */
  discountLeakageDeltaCeil: number;
  /** Claim-gap rule: platform-vs-UTM divergence beyond this fraction fires. */
  claimGapTolerance: number;
  /** CAC ceiling from the account's own variance. Null with too little history. */
  cacCeilingMinor: number | null;
  /** Spend-pacing rule: projected month-end above target × (1 + this) fires. */
  pacingOveragePct: number;
  /** Search-term-waste rule: only flag wasted cost at or above this. */
  searchTermWasteFloorMinor: number;
};

export type CalibrationMonth = {
  period: string;
  /** (net sales − COGS − fees) ÷ net sales, from the margin computer's meta. */
  contributionMarginRate: number | null;
  breakEvenRoas: number | null;
  totalAdSpendMinor: number | null;
  blendedCacMinor: number | null;
  /** discounts ÷ gross sales. */
  discountShare: number | null;
  /** Every per-platform claim-gap value that month. */
  claimGaps: number[];
};

export type CalibrationInput = {
  currency: string;
  months: CalibrationMonth[];
  /** Analyst floor for the minimum impact, minor units (default $50). */
  minImpactFloorMinor?: number;
};

// ---- small statistics, kept local and deterministic for golden tests ----

function median(values: number[]): number | null {
  if (values.length === 0) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 0 ? (sorted[mid - 1]! + sorted[mid]!) / 2 : sorted[mid]!;
}

function mean(values: number[]): number | null {
  if (values.length === 0) return null;
  return values.reduce((s, v) => s + v, 0) / values.length;
}

/** Sample standard deviation (n−1); 0 for a single value. */
function stddev(values: number[]): number {
  if (values.length < 2) return 0;
  const m = mean(values)!;
  const variance = values.reduce((s, v) => s + (v - m) ** 2, 0) / (values.length - 1);
  return Math.sqrt(variance);
}

const clamp = (v: number, lo: number, hi: number): number => Math.min(hi, Math.max(lo, v));

export const DEFAULT_MIN_IMPACT_FLOOR_MINOR = 5_000; // $50
export const DEFAULT_DEAD_CAMPAIGN_FLOOR_MINOR = 10_000; // $100
export const DEFAULT_CLAIM_GAP_TOLERANCE = 0.3;
export const DEFAULT_DISCOUNT_LEAKAGE_CEIL = 0.03;
export const DEFAULT_BRANDED_SHARE_CEIL = 0.35;
export const DEFAULT_PACING_OVERAGE_PCT = 0.1;
export const REFUND_RATE_MULTIPLE = 2;

export function calibrateThresholds(input: CalibrationInput): FindingThresholds {
  const { months } = input;

  // Break-even MER from margin structure: prefer the computed break-even ROAS
  // (1 ÷ contribution margin rate), else derive from the margin rate itself.
  const breakEvenRoasValues = months.map((m) => m.breakEvenRoas).filter((v): v is number => v !== null && v > 0);
  const marginRates = months
    .map((m) => m.contributionMarginRate)
    .filter((v): v is number => v !== null && v > 0);
  let breakEvenMer: number | null = median(breakEvenRoasValues);
  if (breakEvenMer === null) {
    const mr = median(marginRates);
    breakEvenMer = mr === null ? null : round4(1 / mr);
  } else {
    breakEvenMer = round4(breakEvenMer);
  }

  const spends = months.map((m) => m.totalAdSpendMinor).filter((v): v is number => v !== null);
  const medianSpend = median(spends) ?? 0;
  const floor = input.minImpactFloorMinor ?? DEFAULT_MIN_IMPACT_FLOOR_MINOR;
  const minImpactMinor = Math.max(floor, Math.round(medianSpend * 0.01));
  const deadCampaignSpendFloorMinor = Math.max(
    DEFAULT_DEAD_CAMPAIGN_FLOOR_MINOR,
    Math.round(medianSpend * 0.02),
  );

  const cacs = months.map((m) => m.blendedCacMinor).filter((v): v is number => v !== null);
  let cacCeilingMinor: number | null = null;
  if (cacs.length >= 2) cacCeilingMinor = Math.round(mean(cacs)! + stddev(cacs));
  else if (cacs.length === 1) cacCeilingMinor = Math.round(cacs[0]! * 1.5);

  const claimGaps = months.flatMap((m) => m.claimGaps).filter((v) => Number.isFinite(v));
  const claimGapTolerance =
    claimGaps.length > 0
      ? round4(clamp(mean(claimGaps)! + stddev(claimGaps), 0.1, 0.9))
      : DEFAULT_CLAIM_GAP_TOLERANCE;

  const discountShares = months.map((m) => m.discountShare).filter((v): v is number => v !== null);
  const discountLeakageDeltaCeil =
    discountShares.length >= 2
      ? round4(Math.max(0.02, stddev(discountShares)))
      : DEFAULT_DISCOUNT_LEAKAGE_CEIL;

  return {
    breakEvenMer,
    minImpactMinor,
    deadCampaignSpendFloorMinor,
    brandedShareCeil: DEFAULT_BRANDED_SHARE_CEIL,
    refundRateMultiple: REFUND_RATE_MULTIPLE,
    discountLeakageDeltaCeil,
    claimGapTolerance,
    cacCeilingMinor,
    pacingOveragePct: DEFAULT_PACING_OVERAGE_PCT,
    searchTermWasteFloorMinor: minImpactMinor,
  };
}

function round4(v: number): number {
  return Math.round(v * 10_000) / 10_000;
}
