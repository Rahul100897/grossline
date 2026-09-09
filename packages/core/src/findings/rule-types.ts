// The typed input every rule reads (docs/phase-4.md task 4.3). The metric layer
// has already computed every number here; the worker selects them into this
// shape. A rule is a pure function of this input — it never calculates a metric
// and never reads raw data it could hallucinate from. Money is integer minor
// units. `null` means the input is genuinely absent, and rules that depend on
// an absent input return `skipped`, never a finding.
import type { FindingThresholds } from './calibration';
import type { RuleOutcome } from './types';

export type AccountMetrics = {
  currency: string;
  merValue: number | null; // net sales ÷ total ad spend
  netSalesMinor: number | null;
  totalAdSpendMinor: number | null;
  grossSalesMinor: number | null;
  discountsMinor: number | null;
  blendedCacMinor: number | null;
  firstOrderContributionMinor: number | null;
  newCustomerCount: number | null;
  refundRate: number | null; // store-wide, 0..1
  spendMonthToDateMinor: number | null;
  spendProjectedMonthEndMinor: number | null;
};

export type CampaignFact = {
  /** Stable key, e.g. 'campaign:google_ads:123'. */
  key: string;
  label: string;
  platform: string; // 'google_ads' | 'meta'
  spendMinor: number;
  /** Store-attributed orders in the last 30d. null = no attribution available. */
  attributedOrders: number | null;
  /** Whether this is a branded-search campaign. null = not identifiable. */
  isBranded: boolean | null;
};

export type SearchTermFact = {
  key: string;
  label: string;
  costMinor: number;
  conversions: number;
};

export type ProductRefundFact = {
  key: string;
  label: string;
  refundRate: number; // 0..1
  refundedValueMinor: number;
  /** Ad spend attributed to this product this period; null = unknown. */
  attributedSpendMinor: number | null;
};

export type ChannelClaimFact = {
  platform: string;
  label: string;
  claimGap: number; // (platform conversions − store orders) ÷ platform conversions
  platformConversions: number;
  storeOrders: number;
  /** Platform spend under this measurement, for context (never a "loss"). */
  spendMinor: number;
};

/** What data the tenant actually has, so rules skip with a reason vs stay quiet. */
export type DataAvailability = {
  hasMargin: boolean; // cost inputs → contribution margin, break-even MER
  hasGoogle: boolean;
  hasMeta: boolean;
  hasCampaignAttribution: boolean; // per-campaign order attribution
  hasBrandedClassification: boolean;
  hasSearchTerms: boolean;
  hasProductRefunds: boolean;
  hasSpendTarget: boolean;
};

export type FindingsInput = {
  period: string; // YYYY-MM-01
  currency: string;
  account: AccountMetrics;
  /** Prior period's discount share, for the leakage comparison. */
  priorDiscountShare: number | null;
  campaigns: CampaignFact[];
  searchTerms: SearchTermFact[];
  productRefunds: ProductRefundFact[];
  channelClaims: ChannelClaimFact[];
  monthlySpendTargetMinor: number | null;
  thresholds: FindingThresholds;
  availability: DataAvailability;
};

export type Rule = {
  id: string;
  title: string;
  /**
   * Evaluate the rule. Returns one outcome per entity considered: `fired` with
   * a finding, `ok` when evaluated and nothing is wrong, or a single `skipped`
   * (with reason) when the inputs the rule needs are absent.
   */
  run(input: FindingsInput): RuleOutcome[];
};
