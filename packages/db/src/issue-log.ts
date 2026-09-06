// The issue-log transition store (docs/phase-3.md task 3.4). Issues themselves
// are derived in the admin app and never written here as truth; this module
// only records openings and resolutions so the Issues page has a 90-day
// resolved history. All writes are tenant-scoped through withTenant.
import { and, eq, gte, isNull, sql } from 'drizzle-orm';
import { issueLog } from './schema';
import { withTenant } from './tenant-scope';

export type IssueLogRow = typeof issueLog.$inferSelect;

/** One tenant's currently-open issues, as the derivation produced them. */
export type OpenIssueInput = {
  issueKey: string;
  severity: string;
  type: string;
  summary: string;
  action: string;
};

/**
 * Reconcile one tenant's derived open set against the log:
 *  - each open issue with no unresolved row → insert (opened now)
 *  - each open issue that already has an unresolved row → bump last_seen_at
 *    and refresh severity/summary/action (they can change as state moves)
 *  - each unresolved row whose issue is no longer open → set resolved_at
 * `now` is injectable so the caller's clock is the single source of time.
 */
export async function reconcileIssueLog(
  tenantId: string,
  open: OpenIssueInput[],
  now: Date = new Date(),
): Promise<void> {
  const keys = open.map((o) => o.issueKey);
  await withTenant(tenantId, async (tx) => {
    // Resolve rows that are no longer open.
    const openRows = await tx
      .select({ id: issueLog.id, issueKey: issueLog.issueKey })
      .from(issueLog)
      .where(isNull(issueLog.resolvedAt));
    for (const row of openRows) {
      if (!keys.includes(row.issueKey)) {
        await tx.update(issueLog).set({ resolvedAt: now }).where(eq(issueLog.id, row.id));
      }
    }

    // Upsert the currently-open issues onto their unresolved row.
    for (const issue of open) {
      await tx
        .insert(issueLog)
        .values({
          tenantId,
          issueKey: issue.issueKey,
          severity: issue.severity,
          type: issue.type,
          summary: issue.summary,
          action: issue.action,
          openedAt: now,
          lastSeenAt: now,
        })
        .onConflictDoUpdate({
          // Partial unique index: only unresolved rows collide.
          target: [issueLog.tenantId, issueLog.issueKey],
          targetWhere: isNull(issueLog.resolvedAt),
          set: {
            severity: issue.severity,
            summary: issue.summary,
            action: issue.action,
            lastSeenAt: now,
          },
        });
    }
  });
}

export type ResolvedIssue = {
  tenantId: string;
  issueKey: string;
  severity: string;
  type: string;
  summary: string;
  openedAt: Date;
  resolvedAt: Date;
};

/** Resolved rows for one tenant within the last `days` (default 90). */
export async function listResolvedIssues(
  tenantId: string,
  now: Date = new Date(),
  days = 90,
): Promise<ResolvedIssue[]> {
  const cutoff = new Date(now.getTime() - days * 86_400_000);
  const rows = await withTenant(tenantId, (tx) =>
    tx
      .select()
      .from(issueLog)
      .where(and(sql`${issueLog.resolvedAt} is not null`, gte(issueLog.resolvedAt, cutoff)))
      .orderBy(sql`${issueLog.resolvedAt} desc`),
  );
  return rows
    .filter((r): r is IssueLogRow & { resolvedAt: Date } => r.resolvedAt !== null)
    .map((r) => ({
      tenantId: r.tenantId,
      issueKey: r.issueKey,
      severity: r.severity,
      type: r.type,
      summary: r.summary,
      openedAt: r.openedAt,
      resolvedAt: r.resolvedAt,
    }));
}
