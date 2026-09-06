// Read helpers feeding the derived-issues engine (admin lib/issues.ts). These
// only read current state — issues are derived, never stored, so a recovered
// condition simply stops appearing.
import { and, desc, eq } from 'drizzle-orm';
import { metricRuns, metricValues, syncRuns } from './schema';
import { withTenant } from './tenant-scope';

export type LatestSyncRun = {
  status: 'running' | 'success' | 'failed';
  error: string | null;
  finishedAt: Date | null;
  connectionId: string | null;
};

export async function latestSyncRun(
  tenantId: string,
  connectionId: string,
): Promise<LatestSyncRun | null> {
  const [row] = await withTenant(tenantId, (tx) =>
    tx
      .select({
        status: syncRuns.status,
        error: syncRuns.error,
        finishedAt: syncRuns.finishedAt,
        connectionId: syncRuns.connectionId,
      })
      .from(syncRuns)
      .where(eq(syncRuns.connectionId, connectionId))
      .orderBy(desc(syncRuns.startedAt))
      .limit(1),
  );
  return row ?? null;
}

/**
 * The most recent month's COGS completeness for a tenant, from stored metric
 * values (Phase 2 already computed and attached it). Null when no cogs metric
 * exists yet.
 */
export async function latestCostCompleteness(
  tenantId: string,
): Promise<{ period: string; completeness: number; costedLines: number; totalLines: number } | null> {
  const [row] = await withTenant(tenantId, (tx) =>
    tx
      .select({ period: metricValues.period, meta: metricValues.meta })
      .from(metricValues)
      .where(and(eq(metricValues.metric, 'cogs'), eq(metricValues.grain, 'month')))
      .orderBy(desc(metricValues.period))
      .limit(1),
  );
  if (!row) return null;
  const meta = (row.meta ?? {}) as {
    completeness?: number;
    costedLines?: number;
    totalLines?: number;
  };
  if (typeof meta.completeness !== 'number') return null;
  return {
    period: row.period,
    completeness: meta.completeness,
    costedLines: meta.costedLines ?? 0,
    totalLines: meta.totalLines ?? 0,
  };
}

export async function lastMetricRun(
  tenantId: string,
): Promise<{ status: string; error: string | null; finishedAt: Date | null } | null> {
  const [row] = await withTenant(tenantId, (tx) =>
    tx
      .select({ status: metricRuns.status, error: metricRuns.error, finishedAt: metricRuns.finishedAt })
      .from(metricRuns)
      .orderBy(desc(metricRuns.startedAt))
      .limit(1),
  );
  return row ?? null;
}
