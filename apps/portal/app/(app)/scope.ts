import { listMetricPeriods, listMetricValuesForPeriod, type MetricValueRow } from '@grossline/db';
import { requirePortalSession } from '../../lib/session';

/** Resolve the session and its active tenant. Every (app) page starts here; the
 *  tenant id it returns is the only one a page may query with. */
export async function scope() {
  const session = await requirePortalSession();
  return { session, tenantId: session.activeTenantId, role: session.activeRole };
}

/** The latest month's metric rows for a tenant, with lookups keyed by metric. */
export async function latestMonth(tenantId: string): Promise<{
  period: string | null;
  rows: MetricValueRow[];
  tenant: (metric: string) => MetricValueRow | undefined;
  num: (metric: string) => number | null;
}> {
  const periods = await listMetricPeriods(tenantId, 'month');
  const period = periods[0] ?? null;
  const rows = period ? await listMetricValuesForPeriod(tenantId, 'month', period) : [];
  const byTenant = new Map(rows.filter((r) => r.scope === '').map((r) => [r.metric, r]));
  return {
    period,
    rows,
    tenant: (m) => byTenant.get(m),
    num: (m) => {
      const r = byTenant.get(m);
      return r ? Number(r.value) : null;
    },
  };
}
