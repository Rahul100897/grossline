import { describe, expect, it } from 'vitest';
import {
  reconcileFindings,
  type FindingDraft,
  type PriorFinding,
  type ReconciledFinding,
} from '../src/index';

// A minimal draft factory: one account-level rule on one entity.
function draft(over: Partial<FindingDraft> = {}): FindingDraft {
  return {
    ruleId: 'below_break_even_mer',
    severity: 'attention',
    metric: 'mer',
    currentValue: 1.8,
    comparisonValue: 2.4,
    delta: -0.6,
    entity: 'account',
    entityKey: 'account',
    entityLabel: 'Whole account',
    moneyImpactMinor: 120_000,
    currency: 'USD',
    evidence: { mer: 1.8, breakEvenMer: 2.4, spendMinor: 200_000 },
    checkMetric: 'mer',
    checkBaseline: 1.8,
    ...over,
  };
}

/** Turn a persisted finding into the `prior` shape the next period reads. */
function asPrior(f: ReconciledFinding): PriorFinding {
  return {
    ruleId: f.ruleId,
    entityKey: f.entityKey,
    period: f.period,
    firstSeenPeriod: f.firstSeenPeriod,
    occurrenceCount: f.occurrenceCount,
    status: f.status,
    moneyImpactMinor: f.moneyImpactMinor,
    currency: f.currency,
    entity: f.entity,
    entityLabel: f.entityLabel,
    dismissedImpactMinor: f.dismissedImpactMinor,
    checkMetric: f.checkMetric,
    checkBaseline: f.checkBaseline,
  };
}

describe('findings state machine — new → recurring → resolved', () => {
  it('walks three consecutive periods with the correct counts', () => {
    // Period 1: the rule fires for the first time → new, occurrence 1.
    const p1 = reconcileFindings({
      period: '2026-06-01',
      current: [draft()],
      prior: [],
      dismissed: [],
    });
    expect(p1.active).toHaveLength(1);
    expect(p1.active[0]!.status).toBe('new');
    expect(p1.active[0]!.occurrenceCount).toBe(1);
    expect(p1.active[0]!.firstSeenPeriod).toBe('2026-06-01');
    expect(p1.resolved).toHaveLength(0);

    // Period 2: fires again → recurring, occurrence 2, first-seen carried.
    const p2 = reconcileFindings({
      period: '2026-07-01',
      current: [draft({ moneyImpactMinor: 90_000 })],
      prior: p1.active.map(asPrior),
      dismissed: [],
    });
    expect(p2.active[0]!.status).toBe('recurring');
    expect(p2.active[0]!.occurrenceCount).toBe(2);
    expect(p2.active[0]!.firstSeenPeriod).toBe('2026-06-01');
    expect(p2.resolved).toHaveLength(0);

    // Period 3: no longer fires → resolved, carrying first-seen and the count,
    // and the prior period's impact for the closing output.
    const p3 = reconcileFindings({
      period: '2026-08-01',
      current: [],
      prior: p2.active.map(asPrior),
      dismissed: [],
    });
    expect(p3.active).toHaveLength(0);
    expect(p3.resolved).toHaveLength(1);
    expect(p3.resolved[0]!.firstSeenPeriod).toBe('2026-06-01');
    expect(p3.resolved[0]!.occurrenceCount).toBe(2);
    expect(p3.resolved[0]!.priorImpactMinor).toBe(90_000);
    expect(p3.resolved[0]!.checkMetric).toBe('mer');
  });

  it('does not re-emit a resolution once resolved', () => {
    // A finding resolved last period, still absent → nothing this period.
    const priorResolved: PriorFinding = {
      ruleId: 'below_break_even_mer',
      entityKey: 'account',
      period: '2026-07-01',
      firstSeenPeriod: '2026-06-01',
      occurrenceCount: 2,
      status: 'resolved',
      moneyImpactMinor: 90_000,
      currency: 'USD',
      entity: 'account',
      entityLabel: 'Whole account',
      dismissedImpactMinor: null,
      checkMetric: 'mer',
      checkBaseline: 1.8,
    };
    const out = reconcileFindings({
      period: '2026-08-01',
      current: [],
      prior: [priorResolved],
      dismissed: [],
    });
    expect(out.active).toHaveLength(0);
    expect(out.resolved).toHaveLength(0);
  });
});

describe('findings state machine — dismissed is sticky', () => {
  const dismissed: PriorFinding = {
    ruleId: 'below_break_even_mer',
    entityKey: 'account',
    period: '2026-06-01',
    firstSeenPeriod: '2026-06-01',
    occurrenceCount: 1,
    status: 'dismissed',
    moneyImpactMinor: 120_000,
    currency: 'USD',
    entity: 'account',
    entityLabel: 'Whole account',
    dismissedImpactMinor: 120_000,
    checkMetric: 'mer',
    checkBaseline: 1.8,
  };

  it('stays suppressed while the numbers hold', () => {
    // Fires again at a similar impact → suppressed, never new/recurring.
    const out = reconcileFindings({
      period: '2026-07-01',
      current: [draft({ moneyImpactMinor: 130_000 })], // ~8% change, below 25%
      prior: [],
      dismissed: [dismissed],
    });
    expect(out.active).toHaveLength(1);
    expect(out.active[0]!.status).toBe('dismissed');
    expect(out.reactivatedDismissals).toHaveLength(0);
  });

  it('resurfaces only when the impact moves materially', () => {
    // Impact roughly doubles → dismissal cleared, finding returns as new.
    const out = reconcileFindings({
      period: '2026-07-01',
      current: [draft({ moneyImpactMinor: 260_000 })],
      prior: [],
      dismissed: [dismissed],
    });
    expect(out.active[0]!.status).toBe('new');
    expect(out.reactivatedDismissals).toEqual(['account']);
  });
});
