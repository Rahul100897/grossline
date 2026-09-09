// Ranking and suppression (docs/phase-4.md task 4.4, extended for growth in
// docs/phase-5.md task 5.A2). Pure: sort fired findings across BOTH value fields
// — waste/measurement by money impact, growth by opportunity value — in one
// list, suppress anything below the tenant's minimum-impact floor, and cap the
// actionable output at three per period. Suppressed findings are flagged, never
// discarded — the caller still records them so you can see what fell below the
// line. Measurement-risk findings (claim gap) are exempt from both the floor and
// the cap; they carry no money impact and are informational.
//
// Growth discipline (task 5.A2): a report is never only growth findings. Growth
// findings are surfaced only when at least one waste finding also fires this
// period, and at most one growth finding is surfaced per report. A provable
// saving beats a hypothetical gain, so waste ranks above growth at equal value.
import { IMPACT_FLOOR_EXEMPT_RULES } from './rules';
import type { FindingDraft } from './types';
import type { FindingThresholds } from './calibration';

export type RankedFinding = FindingDraft & {
  suppressed: boolean;
  suppressedReason: string | null;
};

export const DEFAULT_FINDINGS_CAP = 3;
/** At most one growth finding is surfaced per report (task 5.A2). */
export const GROWTH_CAP = 1;

/** The value a finding ranks on: opportunity for growth, money impact otherwise. */
function rankValue(f: FindingDraft): number {
  return f.family === 'growth' ? (f.opportunityValueMinor ?? 0) : f.moneyImpactMinor;
}

export function rankAndSuppress(
  findings: FindingDraft[],
  thresholds: FindingThresholds,
  opts: { cap?: number } = {},
): RankedFinding[] {
  const cap = opts.cap ?? DEFAULT_FINDINGS_CAP;

  // Highest value first, across families; ties break waste-before-growth (a
  // provable saving over a hypothetical gain), then by rule id for determinism.
  const familyRank = (f: FindingDraft): number => (f.family === 'growth' ? 1 : 0);
  const sorted = [...findings].sort(
    (a, b) =>
      rankValue(b) - rankValue(a) ||
      familyRank(a) - familyRank(b) ||
      a.ruleId.localeCompare(b.ruleId),
  );

  // A report is never only growth: growth is surfaced only if a waste finding
  // fires and clears the floor this period.
  const hasSurfacedWaste = sorted.some(
    (f) =>
      f.family === 'waste' &&
      !IMPACT_FLOOR_EXEMPT_RULES.has(f.ruleId) &&
      rankValue(f) >= thresholds.minImpactMinor,
  );

  let keptActionable = 0;
  let keptGrowth = 0;
  return sorted.map((f) => {
    // Measurement-risk findings are always kept, and never consume a cap slot.
    if (IMPACT_FLOOR_EXEMPT_RULES.has(f.ruleId)) {
      return { ...f, suppressed: false, suppressedReason: null };
    }
    if (rankValue(f) < thresholds.minImpactMinor) {
      return { ...f, suppressed: true, suppressedReason: 'below the minimum impact threshold' };
    }
    if (f.family === 'growth') {
      if (!hasSurfacedWaste) {
        return {
          ...f,
          suppressed: true,
          suppressedReason: 'no waste finding this period — growth is suppressed',
        };
      }
      if (keptGrowth >= GROWTH_CAP) {
        return { ...f, suppressed: true, suppressedReason: 'over the one-growth-per-report cap' };
      }
      if (keptActionable >= cap) {
        return { ...f, suppressed: true, suppressedReason: 'over the three-per-period cap' };
      }
      keptActionable += 1;
      keptGrowth += 1;
      return { ...f, suppressed: false, suppressedReason: null };
    }
    // waste
    if (keptActionable >= cap) {
      return { ...f, suppressed: true, suppressedReason: 'over the three-per-period cap' };
    }
    keptActionable += 1;
    return { ...f, suppressed: false, suppressedReason: null };
  });
}

/**
 * "Nothing needs changing" — true when no actionable finding survived ranking.
 * Measurement-risk (exempt) findings do not count as something to change.
 */
export function nothingNeedsChanging(ranked: RankedFinding[]): boolean {
  return ranked.every((f) => f.suppressed || IMPACT_FLOOR_EXEMPT_RULES.has(f.ruleId));
}
