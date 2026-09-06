import { and, asc, eq, gte, inArray, lt, sql } from 'drizzle-orm';
import { z } from 'zod';
import { metricRuns, metricValues } from './schema';
import { withTenant } from './tenant-scope';

export type MetricGrain = 'day' | 'month';

export type MetricValueInput = {
  metric: string;
  grain: MetricGrain;
  period: string; // YYYY-MM-DD (month rows use the first day)
  scope?: string;
  /** Decimal string or number. Money must already be integer minor units. */
  value: string | number;
  currency?: string | null;
  meta?: Record<string, unknown> | null;
};

export type MetricValueRow = typeof metricValues.$inferSelect;

const period = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);

export async function upsertMetricValues(
  tenantId: string,
  runId: string | null,
  rows: MetricValueInput[],
): Promise<number> {
  if (rows.length === 0) return 0;
  await withTenant(tenantId, (tx) =>
    tx
      .insert(metricValues)
      .values(
        rows.map((r) => ({
          tenantId,
          metric: r.metric,
          grain: r.grain,
          period: period.parse(r.period),
          scope: r.scope ?? '',
          value: String(r.value),
          currency: r.currency ?? null,
          meta: r.meta ?? null,
          runId,
        })),
      )
      .onConflictDoUpdate({
        target: [
          metricValues.tenantId,
          metricValues.metric,
          metricValues.grain,
          metricValues.period,
          metricValues.scope,
        ],
        set: {
          value: sql`excluded.value`,
          currency: sql`excluded.currency`,
          meta: sql`excluded.meta`,
          computedAt: sql`now()`,
          runId: sql`excluded.run_id`,
        },
      }),
  );
  return rows.length;
}

export async function getMetricValues(
  tenantId: string,
  query: { metric: string; grain: MetricGrain; periods?: string[]; scope?: string },
): Promise<MetricValueRow[]> {
  return withTenant(tenantId, (tx) =>
    tx
      .select()
      .from(metricValues)
      .where(
        and(
          eq(metricValues.metric, query.metric),
          eq(metricValues.grain, query.grain),
          eq(metricValues.scope, query.scope ?? ''),
          ...(query.periods ? [inArray(metricValues.period, query.periods)] : []),
        ),
      )
      .orderBy(asc(metricValues.period)),
  );
}

export async function listMetricValuesForPeriod(
  tenantId: string,
  grain: MetricGrain,
  periodValue: string,
): Promise<MetricValueRow[]> {
  return withTenant(tenantId, (tx) =>
    tx
      .select()
      .from(metricValues)
      .where(and(eq(metricValues.grain, grain), eq(metricValues.period, periodValue)))
      .orderBy(asc(metricValues.metric), asc(metricValues.scope)),
  );
}

/**
 * Day-grain series for one metric+scope within a month (period labels between
 * the month's first day inclusive and the next month's first day exclusive).
 * Ordered by day. Feeds the metrics explorer's monthly→daily drill.
 */
export async function listMetricDailySeries(
  tenantId: string,
  query: { metric: string; monthPeriod: string; scope?: string },
): Promise<MetricValueRow[]> {
  const start = query.monthPeriod;
  const startDate = new Date(`${start}T00:00:00Z`);
  const end = new Date(Date.UTC(startDate.getUTCFullYear(), startDate.getUTCMonth() + 1, 1))
    .toISOString()
    .slice(0, 10);
  return withTenant(tenantId, (tx) =>
    tx
      .select()
      .from(metricValues)
      .where(
        and(
          eq(metricValues.metric, query.metric),
          eq(metricValues.grain, 'day'),
          eq(metricValues.scope, query.scope ?? ''),
          gte(metricValues.period, start),
          lt(metricValues.period, end),
        ),
      )
      .orderBy(asc(metricValues.period)),
  );
}

/** Distinct periods with any stored value at this grain, newest first. */
export async function listMetricPeriods(
  tenantId: string,
  grain: MetricGrain,
): Promise<string[]> {
  const rows = await withTenant(tenantId, (tx) =>
    tx
      .selectDistinct({ period: metricValues.period })
      .from(metricValues)
      .where(eq(metricValues.grain, grain))
      .orderBy(sql`${metricValues.period} desc`),
  );
  return rows.map((r) => r.period);
}

export type MetricRun = typeof metricRuns.$inferSelect;

export async function startMetricRun(
  tenantId: string,
  periodStart: string,
  periodEnd: string,
): Promise<string> {
  const [row] = await withTenant(tenantId, (tx) =>
    tx
      .insert(metricRuns)
      .values({ tenantId, periodStart, periodEnd })
      .returning({ id: metricRuns.id }),
  );
  if (!row) throw new Error('metric run insert returned no row');
  return row.id;
}

export async function finishMetricRun(
  tenantId: string,
  runId: string,
  patch: {
    status: 'success' | 'failed';
    error?: string;
    metricsWritten?: number;
    rawWatermark?: Date | null;
  },
): Promise<void> {
  await withTenant(tenantId, (tx) =>
    tx
      .update(metricRuns)
      .set({
        status: patch.status,
        error: patch.error ?? null,
        metricsWritten: patch.metricsWritten ?? 0,
        rawWatermark: patch.rawWatermark ?? null,
        finishedAt: new Date(),
      })
      .where(eq(metricRuns.id, runId)),
  );
}
