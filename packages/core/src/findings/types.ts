// Findings engine types (docs/phase-4.md). A finding is a structured record —
// numbers first, prose last. Rules produce FindingDraft (all figures, no text);
// the model later writes over those figures and never adds new ones.

export type FindingEntity = 'account' | 'campaign' | 'product' | 'discount' | 'channel';

export type FindingSeverity = 'info' | 'attention' | 'critical';

/**
 * A finding's family (task 5.A1). Waste is provable money being lost; growth is
 * a hypothetical gain (a bounded test, never an instruction); measurement is a
 * data-trust risk with no spend action (claim gap). A finding carries a
 * money_impact (waste/measurement) OR an opportunity_value (growth), never both.
 */
export type FindingFamily = 'waste' | 'growth' | 'measurement';

export type FindingStatus = 'new' | 'recurring' | 'resolved' | 'dismissed';

/** Evidence is the raw numbers behind a finding — for the UI and PR reviewer. */
export type Evidence = Record<string, number | string | boolean | null>;

/** A finding as produced by a rule: every number, no prose. */
export type FindingDraft = {
  ruleId: string;
  severity: FindingSeverity;
  metric: string;
  currentValue: number | null;
  comparisonValue: number | null;
  delta: number | null;
  entity: FindingEntity;
  /** Stable key used to match this finding across periods. */
  entityKey: string;
  entityLabel: string;
  family: FindingFamily;
  /** The sort key for waste/measurement. Integer minor units of `currency`. */
  moneyImpactMinor: number;
  /**
   * The sort key for growth findings — a hypothetical gain, integer minor units.
   * Mutually exclusive with a non-zero moneyImpactMinor (see valueIsExclusive).
   */
  opportunityValueMinor: number | null;
  currency: string | null;
  evidence: Evidence;
  /** The metric that will prove the recommendation right or wrong (task 4.7). */
  checkMetric: string | null;
  /** Its value now, the baseline the next period compares against. */
  checkBaseline: number | null;
};

/**
 * A rule's three possible outcomes. `skipped` (missing inputs) is distinct from
 * `ok` (evaluated, nothing wrong) so a test can prove no rule fires on
 * incomplete data, and so "nothing needs changing" is only claimed when every
 * rule that COULD evaluate returned `ok`.
 */
export type RuleOutcome =
  | { status: 'fired'; finding: FindingDraft }
  | { status: 'ok' }
  | { status: 'skipped'; reason: string };

/** What the state machine needs to know about a previously-stored finding. */
export type PriorFinding = {
  ruleId: string;
  entityKey: string;
  period: string; // YYYY-MM-01
  firstSeenPeriod: string;
  occurrenceCount: number;
  status: FindingStatus;
  family: FindingFamily;
  moneyImpactMinor: number;
  opportunityValueMinor: number | null;
  currency: string | null;
  entity: FindingEntity;
  entityLabel: string;
  /** money_impact captured at dismissal (dismissed rows only). */
  dismissedImpactMinor: number | null;
  /** The recommendation check carried on the finding, for the closing output. */
  checkMetric: string | null;
  checkBaseline: number | null;
};

/** A finding to persist for the current period (new, recurring, or suppressed-dismissed). */
export type ReconciledFinding = FindingDraft & {
  period: string;
  status: FindingStatus;
  firstSeenPeriod: string;
  occurrenceCount: number;
  /** True when a dismissal is still in force (below the material-change bar). */
  dismissedReason: string | null;
  dismissedImpactMinor: number | null;
  /** Set by ranking (task 4.4): below the impact floor or over the per-period cap. */
  suppressed?: boolean;
  suppressedReason?: string | null;
};

/** A finding that stopped triggering this period — generates a closing output. */
export type ResolvedFinding = {
  ruleId: string;
  entity: FindingEntity;
  entityKey: string;
  entityLabel: string;
  family: FindingFamily;
  period: string; // the period in which it resolved
  firstSeenPeriod: string;
  occurrenceCount: number;
  priorImpactMinor: number;
  currency: string | null;
  checkMetric: string | null;
  checkBaseline: number | null;
};

/**
 * A finding may carry a money_impact OR an opportunity_value, never both
 * (task 5.A1). True when the pair is exclusive: an opportunity_value only ever
 * sits alongside a zero money_impact. The database enforces the same rule with a
 * check constraint; this is the pure guard the rules and tests use.
 */
export function valueIsExclusive(f: {
  moneyImpactMinor: number;
  opportunityValueMinor: number | null;
}): boolean {
  return f.opportunityValueMinor === null || f.moneyImpactMinor === 0;
}

export type ReconcileInput = {
  period: string; // YYYY-MM-01, the period being computed
  /** Rules that fired this period. */
  current: FindingDraft[];
  /** Last period's stored findings (any status), for recurrence/resolution. */
  prior: PriorFinding[];
  /** Findings currently dismissed (sticky across periods), latest per key. */
  dismissed: PriorFinding[];
  /**
   * A dismissed finding resurfaces when its money impact moves by at least this
   * fraction of the dismissed impact. Default 0.25.
   */
  materialChangeFraction?: number;
};

export type ReconcileOutput = {
  /** Findings to write for this period (new / recurring / suppressed-dismissed). */
  active: ReconciledFinding[];
  /** Transitions to resolved this period. */
  resolved: ResolvedFinding[];
  /** Entity keys whose dismissal was cleared by a material change. */
  reactivatedDismissals: string[];
};
