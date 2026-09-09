// Ranking and suppression (docs/phase-4.md task 4.4). Pure: sort fired findings
// by money impact, suppress anything below the tenant's minimum-impact floor,
// and cap the actionable output at three per period. Suppressed findings are
// flagged, never discarded — the caller still records them so you can see what
// fell below the line. Measurement-risk findings (claim gap) are exempt from
// both the floor and the cap; they carry no money impact and are informational.
import { IMPACT_FLOOR_EXEMPT_RULES } from './rules';
import type { FindingDraft } from './types';
import type { FindingThresholds } from './calibration';

export type RankedFinding = FindingDraft & {
  suppressed: boolean;
  suppressedReason: string | null;
};

export const DEFAULT_FINDINGS_CAP = 3;

export function rankAndSuppress(
  findings: FindingDraft[],
  thresholds: FindingThresholds,
  opts: { cap?: number } = {},
): RankedFinding[] {
  const cap = opts.cap ?? DEFAULT_FINDINGS_CAP;
  // Highest money impact first; ties broken by rule id for determinism.
  const sorted = [...findings].sort(
    (a, b) => b.moneyImpactMinor - a.moneyImpactMinor || a.ruleId.localeCompare(b.ruleId),
  );

  let keptActionable = 0;
  return sorted.map((f) => {
    const exempt = IMPACT_FLOOR_EXEMPT_RULES.has(f.ruleId);
    if (exempt) {
      // Measurement-risk findings are always kept, and never consume a cap slot.
      return { ...f, suppressed: false, suppressedReason: null };
    }
    if (f.moneyImpactMinor < thresholds.minImpactMinor) {
      return { ...f, suppressed: true, suppressedReason: 'below the minimum impact threshold' };
    }
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
