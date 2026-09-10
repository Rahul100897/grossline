// Reconciliation-run records (docs/phase-5.md task B4). Tenant-scoped through
// withTenant; RLS-isolated. The report send gate reads getReconciliationRun to
// enforce "nothing goes out unreconciled". A run is upserted per (tenant,
// period): the latest run for a month replaces the previous record.
import { desc, eq } from 'drizzle-orm';
import { reconciliationRuns } from './schema';
import { withTenant } from './tenant-scope';

export type ReconciliationRun = typeof reconciliationRuns.$inferSelect;

export async function recordReconciliationRun(
  tenantId: string,
  period: string,
  status: 'ok' | 'variance',
  summary: string | null,
): Promise<void> {
  await withTenant(tenantId, (tx) =>
    tx
      .insert(reconciliationRuns)
      .values({ tenantId, period, status, summary })
      .onConflictDoUpdate({
        target: [reconciliationRuns.tenantId, reconciliationRuns.period],
        set: { ranAt: new Date(), status, summary },
      }),
  );
}

export async function getReconciliationRun(
  tenantId: string,
  period: string,
): Promise<ReconciliationRun | null> {
  const [row] = await withTenant(tenantId, (tx) =>
    tx.select().from(reconciliationRuns).where(eq(reconciliationRuns.period, period)).limit(1),
  );
  return row ?? null;
}

export async function listReconciliationRuns(tenantId: string): Promise<ReconciliationRun[]> {
  return withTenant(tenantId, (tx) =>
    tx.select().from(reconciliationRuns).orderBy(desc(reconciliationRuns.period)),
  );
}
