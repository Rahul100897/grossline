// Reports data access (docs/phase-5.md task B3). Tenant-scoped through
// withTenant; the reports table carries the standard RLS policy. The snapshot is
// stored opaquely (the worker owns the ReportModel shape) so this package stays
// decoupled from the report template. A sent report is frozen — its snapshot is
// never rebuilt.
import { and, desc, eq } from 'drizzle-orm';
import { reports } from './schema';
import { withTenant } from './tenant-scope';

export type Report = typeof reports.$inferSelect;

/**
 * Create or update the draft snapshot for a tenant + period. Rebuilding replaces
 * a draft/approved snapshot; a SENT report is immutable and is never overwritten
 * (the caller gets the existing sent row back unchanged).
 */
export async function upsertReportSnapshot(
  tenantId: string,
  period: string,
  snapshot: unknown,
): Promise<Report> {
  return withTenant(tenantId, async (tx) => {
    const [existing] = await tx
      .select()
      .from(reports)
      .where(eq(reports.period, period))
      .limit(1);
    if (existing && existing.status === 'sent') {
      // Frozen: never overwrite what was sent.
      return existing;
    }
    if (existing) {
      const [row] = await tx
        .update(reports)
        .set({ snapshot, status: 'draft', builtAt: new Date(), updatedAt: new Date() })
        .where(eq(reports.id, existing.id))
        .returning();
      return row!;
    }
    const [row] = await tx
      .insert(reports)
      .values({ tenantId, period, snapshot, status: 'draft' })
      .returning();
    return row!;
  });
}

export async function getReport(tenantId: string, period: string): Promise<Report | null> {
  const [row] = await withTenant(tenantId, (tx) =>
    tx.select().from(reports).where(eq(reports.period, period)).limit(1),
  );
  return row ?? null;
}

export async function getReportById(tenantId: string, id: string): Promise<Report | null> {
  const [row] = await withTenant(tenantId, (tx) =>
    tx.select().from(reports).where(eq(reports.id, id)).limit(1),
  );
  return row ?? null;
}

export async function listReports(tenantId: string): Promise<Report[]> {
  return withTenant(tenantId, (tx) =>
    tx.select().from(reports).orderBy(desc(reports.period)),
  );
}

/** Mark a report ready to send (reviewed). No-op once sent. */
export async function markReportApproved(tenantId: string, id: string): Promise<void> {
  await withTenant(tenantId, (tx) =>
    tx
      .update(reports)
      .set({ status: 'approved', updatedAt: new Date() })
      .where(and(eq(reports.id, id), eq(reports.status, 'draft'))),
  );
}

/** Record delivery: freeze the report as sent with its recipients. */
export async function markReportSent(
  tenantId: string,
  id: string,
  recipients: string[],
): Promise<void> {
  await withTenant(tenantId, (tx) =>
    tx
      .update(reports)
      .set({ status: 'sent', sentAt: new Date(), recipients, updatedAt: new Date() })
      .where(eq(reports.id, id)),
  );
}
