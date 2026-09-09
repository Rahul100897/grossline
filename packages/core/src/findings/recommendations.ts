// Recommendation tracking (docs/phase-4.md task 4.7). Every approved finding
// carries a check-metric forward; next period the engine measures it and
// classifies what happened. Pure: the movement of the check metric in, a
// status out. The four-part note's "what we check next month" is what makes
// this possible.

import type { FindingFamily } from './types';

export type RecStatus = 'pending' | 'resolved' | 'improving' | 'unchanged' | 'worsened';

/** Check metrics where a lower value next period is the improvement. */
const LOWER_IS_BETTER = new Set<string>([
  'blended_cac',
  'discount_share',
  'spend_projected_month_end',
  'search_term_cost',
  'refund_rate',
  'branded_search_share',
  'claim_gap',
  'ad_spend',
]);
/** Check metrics where a higher value next period is the improvement. */
const HIGHER_IS_BETTER = new Set<string>(['mer', 'platform_roas']);

/** Minimum relative move to count as improved/worsened rather than unchanged. */
const MOVE_THRESHOLD = 0.02;

export type RecommendationInput = {
  checkMetric: string | null;
  baseline: number | null;
  /** The check metric's value next period; null when not measurable. */
  measured: number | null;
  /** Did the finding stop firing next period? */
  resolvedNextPeriod: boolean;
  /** Was next period computed at all? */
  computedNextPeriod: boolean;
  /** The finding's family (task 5.A6). Growth outcomes are read differently. */
  family?: FindingFamily;
};

export type RecommendationJudgement = {
  status: RecStatus;
  /** true actioned, false not actioned, null undetermined (pending). */
  actioned: boolean | null;
  /** Signed relative change of the check metric, or null. */
  relativeChange: number | null;
};

export function classifyRecommendation(input: RecommendationInput): RecommendationJudgement {
  if (!input.computedNextPeriod) return { status: 'pending', actioned: null, relativeChange: null };
  if (input.resolvedNextPeriod) return { status: 'resolved', actioned: true, relativeChange: null };
  if (input.baseline === null || input.measured === null || input.baseline === 0) {
    return { status: 'pending', actioned: null, relativeChange: null };
  }

  const relativeChange = (input.measured - input.baseline) / Math.abs(input.baseline);
  const lowerBetter = input.checkMetric === null ? true : !HIGHER_IS_BETTER.has(input.checkMetric);
  void LOWER_IS_BETTER; // documented default; HIGHER_IS_BETTER is the exception set
  const improved = lowerBetter ? input.measured < input.baseline : input.measured > input.baseline;
  const magnitude = Math.abs(relativeChange);

  if (magnitude < MOVE_THRESHOLD) return { status: 'unchanged', actioned: false, relativeChange };
  if (improved) return { status: 'improving', actioned: true, relativeChange };
  // Worsened. For a growth recommendation this is a genuine "we suggested a
  // bounded increase, you tried it, efficiency did not hold, we would revert"
  // outcome — actioned, not hidden. For a waste finding a worsened metric means
  // the problem got worse and was not acted on.
  const actioned = input.family === 'growth';
  return { status: 'worsened', actioned, relativeChange };
}
