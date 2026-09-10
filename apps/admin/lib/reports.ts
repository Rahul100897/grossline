// Report console helpers (docs/phase-5.md task B4). The send gate is the safety
// rail: nothing goes out unreviewed or unreconciled. Read-only checks over
// findings + reconciliation-run state; the send action enforces the same gate.
import { countUnreviewedFindings, getReconciliationRun } from '@grossline/db';

export type SendGate = {
  canSend: boolean;
  reasons: string[];
  unreviewedCount: number;
  reconciled: boolean;
};

/**
 * Whether a report for (tenant, period) may be sent. Blocked when any finding is
 * still unreviewed (Phase 4.8's blocking condition, enforced here at the send
 * step) or when reconciliation has not been run for the period.
 */
export async function computeSendGate(tenantId: string, period: string): Promise<SendGate> {
  const [unreviewedCount, reconRun] = await Promise.all([
    countUnreviewedFindings(tenantId, period),
    getReconciliationRun(tenantId, period),
  ]);
  const reasons: string[] = [];
  if (unreviewedCount > 0) {
    reasons.push(
      `${unreviewedCount} finding${unreviewedCount === 1 ? '' : 's'} still awaiting review — approve or dismiss them first.`,
    );
  }
  if (reconRun === null) {
    reasons.push(
      'Reconciliation has not been run for this period — open the Reconciliation panel for this month.',
    );
  }
  return {
    canSend: reasons.length === 0,
    reasons,
    unreviewedCount,
    reconciled: reconRun !== null,
  };
}
