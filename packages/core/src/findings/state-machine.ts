// The findings state machine (docs/phase-4.md task 4.1). Pure: given this
// period's fired rules, last period's stored findings, and the active
// dismissals, it computes every transition — new, recurring, resolved — and
// the suppression of sticky dismissals. Nothing here reads the database or
// hand-sets a status; the worker persists what this returns.
import type {
  FindingDraft,
  PriorFinding,
  ReconcileInput,
  ReconcileOutput,
  ReconciledFinding,
  ResolvedFinding,
} from './types';

const keyOf = (f: { ruleId: string; entityKey: string }): string => `${f.ruleId}\0${f.entityKey}`;

/** True when the new impact has moved materially from the dismissed impact. */
function materiallyChanged(
  currentImpactMinor: number,
  dismissedImpactMinor: number | null,
  fraction: number,
): boolean {
  if (dismissedImpactMinor === null) return true;
  const base = Math.max(Math.abs(dismissedImpactMinor), 1);
  return Math.abs(currentImpactMinor - dismissedImpactMinor) / base >= fraction;
}

export function reconcileFindings(input: ReconcileInput): ReconcileOutput {
  const fraction = input.materialChangeFraction ?? 0.25;
  const priorByKey = new Map<string, PriorFinding>(input.prior.map((p) => [keyOf(p), p]));
  const dismissedByKey = new Map<string, PriorFinding>(input.dismissed.map((d) => [keyOf(d), d]));
  const currentKeys = new Set<string>(input.current.map(keyOf));

  const active: ReconciledFinding[] = [];
  const reactivatedDismissals: string[] = [];

  for (const draft of input.current) {
    const key = keyOf(draft);
    const dismissed = dismissedByKey.get(key);

    if (
      dismissed &&
      !materiallyChanged(draft.moneyImpactMinor, dismissed.dismissedImpactMinor, fraction)
    ) {
      // Sticky dismissal still in force — persist as dismissed, suppressed.
      active.push({
        ...draft,
        period: input.period,
        status: 'dismissed',
        firstSeenPeriod: dismissed.firstSeenPeriod,
        occurrenceCount: dismissed.occurrenceCount,
        dismissedReason: null,
        dismissedImpactMinor: dismissed.dismissedImpactMinor,
      });
      continue;
    }
    if (dismissed) {
      // The numbers moved materially: the dismissal is cleared, finding returns.
      reactivatedDismissals.push(draft.entityKey);
    }

    const prior = priorByKey.get(key);
    const firedLastPeriod = prior && (prior.status === 'new' || prior.status === 'recurring');
    if (firedLastPeriod && !dismissed) {
      active.push(recurring(draft, input.period, prior));
    } else {
      active.push(fresh(draft, input.period));
    }
  }

  // Resolution: a finding that fired last period (new/recurring) and no longer
  // triggers, and is not currently dismissed.
  const resolved: ResolvedFinding[] = [];
  for (const prior of input.prior) {
    const key = keyOf(prior);
    if (prior.status !== 'new' && prior.status !== 'recurring') continue;
    if (currentKeys.has(key)) continue;
    if (dismissedByKey.has(key)) continue;
    resolved.push({
      ruleId: prior.ruleId,
      entity: prior.entity,
      entityKey: prior.entityKey,
      entityLabel: prior.entityLabel,
      family: prior.family,
      period: input.period,
      firstSeenPeriod: prior.firstSeenPeriod,
      occurrenceCount: prior.occurrenceCount,
      priorImpactMinor: prior.moneyImpactMinor,
      currency: prior.currency,
      checkMetric: prior.checkMetric,
      checkBaseline: prior.checkBaseline,
    });
  }

  return { active, resolved, reactivatedDismissals };
}

function fresh(draft: FindingDraft, period: string): ReconciledFinding {
  return {
    ...draft,
    period,
    status: 'new',
    firstSeenPeriod: period,
    occurrenceCount: 1,
    dismissedReason: null,
    dismissedImpactMinor: null,
  };
}

function recurring(draft: FindingDraft, period: string, prior: PriorFinding): ReconciledFinding {
  return {
    ...draft,
    period,
    status: 'recurring',
    firstSeenPeriod: prior.firstSeenPeriod,
    occurrenceCount: prior.occurrenceCount + 1,
    dismissedReason: null,
    dismissedImpactMinor: null,
  };
}
