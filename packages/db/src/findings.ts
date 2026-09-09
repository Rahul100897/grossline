// Findings data access (docs/phase-4.md). Tenant-scoped through withTenant; the
// findings and tenant_calibration tables carry the standard RLS policy. Numbers
// come out of Postgres numeric columns as strings — the mappers convert to the
// core types the state machine and rules expect.
import { and, desc, eq, isNull, sql } from 'drizzle-orm';
import type {
  FindingEntity,
  FindingStatus,
  PriorFinding,
  ReconciledFinding,
  ResolvedFinding,
} from '@grossline/core';
import { findings } from './schema';
import { withTenant } from './tenant-scope';

export type Finding = typeof findings.$inferSelect;

const numOrNull = (v: string | null): number | null => (v === null ? null : Number(v));

function toPrior(row: Finding): PriorFinding {
  return {
    ruleId: row.ruleId,
    entityKey: row.entityKey,
    period: row.period,
    firstSeenPeriod: row.firstSeenPeriod,
    occurrenceCount: row.occurrenceCount,
    status: row.status as FindingStatus,
    moneyImpactMinor: row.moneyImpactMinor,
    currency: row.currency,
    entity: row.entity as FindingEntity,
    entityLabel: row.entityLabel,
    dismissedImpactMinor: row.dismissedImpactMinor,
    checkMetric: row.checkMetric,
    checkBaseline: numOrNull(row.checkBaseline),
  };
}

/** Last period's findings, as the state machine's `prior` input. */
export async function getFindingsForReconcile(
  tenantId: string,
  priorPeriod: string,
): Promise<PriorFinding[]> {
  const rows = await withTenant(tenantId, (tx) =>
    tx.select().from(findings).where(eq(findings.period, priorPeriod)),
  );
  return rows.map(toPrior);
}

/** The active dismissals (latest dismissed row per rule+entity), sticky across periods. */
export async function getDismissedFindings(tenantId: string): Promise<PriorFinding[]> {
  const rows = await withTenant(tenantId, (tx) =>
    tx
      .select()
      .from(findings)
      .where(eq(findings.status, 'dismissed'))
      .orderBy(desc(findings.period)),
  );
  // Keep only the most recent dismissal per rule+entity.
  const seen = new Set<string>();
  const latest: Finding[] = [];
  for (const row of rows) {
    const key = `${row.ruleId} ${row.entityKey}`;
    if (seen.has(key)) continue;
    seen.add(key);
    latest.push(row);
  }
  return latest.map(toPrior);
}

/**
 * Persist a period's reconciled findings idempotently. Upserts the active set
 * on the unique key, writes resolved-transition rows, and removes stale rows
 * from a prior run of the same period that the new run no longer produced —
 * except rows an analyst has touched (approved, edited, or dismissed), which
 * are preserved.
 */
export async function writeReconciledFindings(
  tenantId: string,
  period: string,
  active: ReconciledFinding[],
  resolved: ResolvedFinding[],
): Promise<void> {
  await withTenant(tenantId, async (tx) => {
    const producedKeys = new Set<string>([
      ...active.map((f) => `${f.ruleId} ${f.entityKey}`),
      ...resolved.map((f) => `${f.ruleId} ${f.entityKey}`),
    ]);

    // Remove untouched rows from a previous run of this period that vanished.
    const existing = await tx
      .select()
      .from(findings)
      .where(eq(findings.period, period));
    for (const row of existing) {
      const key = `${row.ruleId} ${row.entityKey}`;
      const touched = row.approvedAt !== null || row.editedAt !== null || row.status === 'dismissed';
      if (!producedKeys.has(key) && !touched) {
        await tx.delete(findings).where(eq(findings.id, row.id));
      }
    }

    for (const f of active) {
      await tx
        .insert(findings)
        .values({
          tenantId,
          period,
          ruleId: f.ruleId,
          severity: f.severity,
          metric: f.metric,
          currentValue: f.currentValue === null ? null : String(f.currentValue),
          comparisonValue: f.comparisonValue === null ? null : String(f.comparisonValue),
          delta: f.delta === null ? null : String(f.delta),
          entity: f.entity,
          entityKey: f.entityKey,
          entityLabel: f.entityLabel,
          moneyImpactMinor: f.moneyImpactMinor,
          currency: f.currency,
          evidence: f.evidence,
          status: f.status,
          firstSeenPeriod: f.firstSeenPeriod,
          occurrenceCount: f.occurrenceCount,
          suppressed: f.suppressed ?? false,
          suppressedReason: f.suppressedReason ?? null,
          checkMetric: f.checkMetric,
          checkBaseline: f.checkBaseline === null ? null : String(f.checkBaseline),
          dismissedReason: f.dismissedReason,
          dismissedImpactMinor: f.dismissedImpactMinor,
        })
        .onConflictDoUpdate({
          target: [findings.tenantId, findings.period, findings.ruleId, findings.entityKey],
          set: {
            severity: f.severity,
            metric: f.metric,
            currentValue: f.currentValue === null ? null : String(f.currentValue),
            comparisonValue: f.comparisonValue === null ? null : String(f.comparisonValue),
            delta: f.delta === null ? null : String(f.delta),
            entityLabel: f.entityLabel,
            moneyImpactMinor: f.moneyImpactMinor,
            currency: f.currency,
            evidence: f.evidence,
            // Preserve a dismissal that is still in force.
            status: sql`case when ${findings.status} = 'dismissed' then 'dismissed'::finding_status else ${f.status}::finding_status end`,
            firstSeenPeriod: f.firstSeenPeriod,
            occurrenceCount: f.occurrenceCount,
            suppressed: f.suppressed ?? false,
            suppressedReason: f.suppressedReason ?? null,
            checkMetric: f.checkMetric,
            checkBaseline: f.checkBaseline === null ? null : String(f.checkBaseline),
          },
        });
    }

    for (const r of resolved) {
      await tx
        .insert(findings)
        .values({
          tenantId,
          period,
          ruleId: r.ruleId,
          severity: 'info',
          metric: r.checkMetric ?? r.ruleId,
          entity: r.entity,
          entityKey: r.entityKey,
          entityLabel: r.entityLabel,
          moneyImpactMinor: 0,
          currency: r.currency,
          evidence: {
            resolved: true,
            priorImpactMinor: r.priorImpactMinor,
            firstSeenPeriod: r.firstSeenPeriod,
            occurrenceCount: r.occurrenceCount,
          },
          status: 'resolved',
          firstSeenPeriod: r.firstSeenPeriod,
          occurrenceCount: r.occurrenceCount,
          checkMetric: r.checkMetric,
          checkBaseline: r.checkBaseline === null ? null : String(r.checkBaseline),
        })
        .onConflictDoUpdate({
          target: [findings.tenantId, findings.period, findings.ruleId, findings.entityKey],
          set: {
            status: sql`case when ${findings.status} = 'dismissed' then 'dismissed'::finding_status else 'resolved'::finding_status end`,
            moneyImpactMinor: 0,
            evidence: {
              resolved: true,
              priorImpactMinor: r.priorImpactMinor,
              firstSeenPeriod: r.firstSeenPeriod,
              occurrenceCount: r.occurrenceCount,
            },
          },
        });
    }
  });
}

export type FindingFilter = { period?: string; status?: FindingStatus; includeSuppressed?: boolean };

export async function listFindings(
  tenantId: string,
  filter: FindingFilter = {},
): Promise<Finding[]> {
  const clauses = [
    filter.period ? eq(findings.period, filter.period) : undefined,
    filter.status ? eq(findings.status, filter.status) : undefined,
    filter.includeSuppressed ? undefined : eq(findings.suppressed, false),
  ].filter(Boolean);
  return withTenant(tenantId, (tx) =>
    tx
      .select()
      .from(findings)
      .where(clauses.length > 0 ? and(...(clauses as NonNullable<(typeof clauses)[number]>[])) : undefined)
      .orderBy(desc(findings.moneyImpactMinor)),
  );
}

export async function getFinding(tenantId: string, id: string): Promise<Finding | null> {
  const [row] = await withTenant(tenantId, (tx) =>
    tx.select().from(findings).where(eq(findings.id, id)).limit(1),
  );
  return row ?? null;
}

/** Periods that have any findings, newest first — for the review picker. */
export async function listFindingPeriods(tenantId: string): Promise<string[]> {
  const rows = await withTenant(tenantId, (tx) =>
    tx
      .selectDistinct({ period: findings.period })
      .from(findings)
      .orderBy(desc(findings.period)),
  );
  return rows.map((r) => r.period);
}

/** Unreviewed (not approved, not dismissed, not suppressed) findings for a period. */
export async function countUnreviewedFindings(tenantId: string, period: string): Promise<number> {
  const rows = await withTenant(tenantId, (tx) =>
    tx
      .select({ id: findings.id })
      .from(findings)
      .where(
        and(
          eq(findings.period, period),
          eq(findings.suppressed, false),
          isNull(findings.approvedAt),
          // resolved and dismissed findings are outcomes, not review work.
          sql`${findings.status} in ('new', 'recurring')`,
        ),
      ),
  );
  return rows.length;
}

/** Periods with at least one unreviewed finding, newest first. */
export async function periodsWithUnreviewedFindings(tenantId: string): Promise<string[]> {
  const rows = await withTenant(tenantId, (tx) =>
    tx
      .selectDistinct({ period: findings.period })
      .from(findings)
      .where(
        and(
          eq(findings.suppressed, false),
          isNull(findings.approvedAt),
          sql`${findings.status} in ('new', 'recurring')`,
        ),
      )
      .orderBy(desc(findings.period)),
  );
  return rows.map((r) => r.period);
}

// ---- review mutations (task 4.5) ----

/** Approve a finding for sending (Phase 5 delivers the approved set). */
export async function approveFinding(tenantId: string, id: string): Promise<void> {
  await withTenant(tenantId, (tx) =>
    tx.update(findings).set({ approvedAt: new Date() }).where(eq(findings.id, id)),
  );
}

export async function unapproveFinding(tenantId: string, id: string): Promise<void> {
  await withTenant(tenantId, (tx) =>
    tx.update(findings).set({ approvedAt: null }).where(eq(findings.id, id)),
  );
}

/**
 * Dismiss a finding (manual, sticky). Captures the current money impact so the
 * state machine can resurface it only when the numbers move materially. Marking
 * it "deliberate" is a dismissal with that reason.
 */
export async function dismissFinding(
  tenantId: string,
  id: string,
  reason: string,
): Promise<void> {
  await withTenant(tenantId, async (tx) => {
    const [row] = await tx.select().from(findings).where(eq(findings.id, id)).limit(1);
    if (!row) return;
    await tx
      .update(findings)
      .set({
        status: 'dismissed',
        dismissedReason: reason,
        dismissedImpactMinor: row.moneyImpactMinor,
        approvedAt: null,
      })
      .where(eq(findings.id, id));
  });
}

/** Reopen a dismissed finding back to its lifecycle status (new). */
export async function reopenFinding(tenantId: string, id: string): Promise<void> {
  await withTenant(tenantId, (tx) =>
    tx
      .update(findings)
      .set({ status: 'new', dismissedReason: null, dismissedImpactMinor: null })
      .where(eq(findings.id, id)),
  );
}

/** Save the analyst-edited final text and stamp edited_at. */
export async function saveFindingText(
  tenantId: string,
  id: string,
  finalText: string,
): Promise<void> {
  await withTenant(tenantId, (tx) =>
    tx
      .update(findings)
      .set({ finalText: finalText.trim() === '' ? null : finalText, editedAt: new Date() })
      .where(eq(findings.id, id)),
  );
}

/** Save a model draft (task 4.6). Never overwrites an analyst's final edit. */
export async function saveFindingDraft(
  tenantId: string,
  id: string,
  draftText: string,
): Promise<void> {
  await withTenant(tenantId, (tx) =>
    tx.update(findings).set({ draftText }).where(eq(findings.id, id)),
  );
}
