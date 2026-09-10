// The findings pipeline (docs/phase-4.md tasks 4.3–4.4): for a tenant and
// month, build the input, run every rule, rank and suppress, reconcile against
// last period and the active dismissals, and persist. Recomputable any number
// of times — analyst-touched rows are preserved by writeReconciledFindings.
import {
  RULES,
  rankAndSuppress,
  reconcileFindings,
  logger,
  type FindingDraft,
  type FindingThresholds,
  type RankedFinding,
  type ReconciledFinding,
  type ResolvedFinding,
} from '@grossline/core';
import {
  getFindingsForReconcile,
  getDismissedFindings,
  getTenant,
  writeReconciledFindings,
} from '@grossline/db';
import { thresholdsFor } from './calibrate';
import { buildFindingsInput } from './build-input';

function priorPeriodOf(period: string): string {
  const d = new Date(`${period}T00:00:00Z`);
  return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() - 1, 1)).toISOString().slice(0, 10);
}

export type PipelineResult = {
  period: string;
  fired: number;
  actionable: number; // surfaced (not suppressed, not measurement-risk-only)
  suppressed: number;
  resolved: number;
  skipped: { ruleId: string; reason: string }[];
  nothingToChange: boolean;
  ranked: RankedFinding[];
  active: ReconciledFinding[];
  resolvedFindings: ResolvedFinding[];
  thresholds: FindingThresholds;
};

export async function runFindings(tenantId: string, period: string): Promise<PipelineResult> {
  const tenant = await getTenant(tenantId);
  if (!tenant) throw new Error(`tenant not found: ${tenantId}`);
  const thresholds = await thresholdsFor(tenantId);

  const input = await buildFindingsInput(tenantId, period, tenant.reportingCurrency, thresholds);

  const fired: FindingDraft[] = [];
  const skipped: { ruleId: string; reason: string }[] = [];
  for (const rule of RULES) {
    for (const outcome of rule.run(input)) {
      if (outcome.status === 'fired') fired.push(outcome.finding);
      else if (outcome.status === 'skipped')
        skipped.push({ ruleId: rule.id, reason: outcome.reason });
    }
  }

  const ranked = rankAndSuppress(fired, thresholds);
  const suppressionByKey = new Map<string, RankedFinding>(
    ranked.map((f) => [`${f.ruleId} ${f.entityKey}`, f]),
  );

  const [prior, dismissed] = await Promise.all([
    getFindingsForReconcile(tenantId, priorPeriodOf(period)),
    getDismissedFindings(tenantId),
  ]);
  const { active, resolved } = reconcileFindings({ period, current: fired, prior, dismissed });

  // Carry the suppression flags from ranking onto the reconciled findings.
  const activeWithSuppression: ReconciledFinding[] = active.map((f) => {
    const ranking = suppressionByKey.get(`${f.ruleId} ${f.entityKey}`);
    return {
      ...f,
      suppressed: ranking?.suppressed ?? false,
      suppressedReason: ranking?.suppressedReason ?? null,
    };
  });

  await writeReconciledFindings(tenantId, period, activeWithSuppression, resolved);

  const actionable = activeWithSuppression.filter(
    (f) =>
      !f.suppressed && f.severity !== 'info' && (f.status === 'new' || f.status === 'recurring'),
  ).length;

  const result: PipelineResult = {
    period,
    fired: fired.length,
    actionable,
    suppressed: ranked.filter((f) => f.suppressed).length,
    resolved: resolved.length,
    skipped,
    nothingToChange: actionable === 0,
    ranked,
    active: activeWithSuppression,
    resolvedFindings: resolved,
    thresholds,
  };
  logger.info('findings computed', {
    tenantId,
    period,
    fired: result.fired,
    actionable: result.actionable,
    suppressed: result.suppressed,
    resolved: result.resolved,
    nothingToChange: result.nothingToChange,
  });
  return result;
}
