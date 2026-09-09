// Loads a tenant's stored metric values for a month into a typed snapshot the
// findings rules and calibration read from (docs/phase-4.md). The metric layer
// already computed every number; nothing here calculates a metric — it selects,
// converts numeric strings, and exposes tenant-level and scoped accessors.
import { listMetricValuesForPeriod, type MetricValueRow } from '@grossline/db';

export type MetricSnapshot = {
  value: number;
  currency: string | null;
  meta: Record<string, unknown>;
};
export type ScopedMetric = MetricSnapshot & { scope: string };

/** A month's metric values with accessors by metric and scope. */
export class MetricBundle {
  private readonly byMetricScope = new Map<string, MetricValueRow>();
  private readonly byMetric = new Map<string, MetricValueRow[]>();

  constructor(rows: MetricValueRow[]) {
    for (const row of rows) {
      this.byMetricScope.set(`${row.metric}${row.scope}`, row);
      const list = this.byMetric.get(row.metric) ?? [];
      list.push(row);
      this.byMetric.set(row.metric, list);
    }
  }

  /** Tenant-level (scope '') value for a metric, or null if not computed. */
  tenant(metric: string): MetricSnapshot | null {
    return this.at(metric, '');
  }

  at(metric: string, scope: string): MetricSnapshot | null {
    const row = this.byMetricScope.get(`${metric}${scope}`);
    return row ? snapshot(row) : null;
  }

  /** Every scoped (scope ≠ '') value for a metric. */
  scoped(metric: string): ScopedMetric[] {
    return (this.byMetric.get(metric) ?? [])
      .filter((r) => r.scope !== '')
      .map((r) => ({ ...snapshot(r), scope: r.scope }));
  }

  has(metric: string): boolean {
    return this.byMetric.has(metric);
  }
}

function snapshot(row: MetricValueRow): MetricSnapshot {
  return {
    value: Number(row.value),
    currency: row.currency,
    meta: (row.meta ?? {}) as Record<string, unknown>,
  };
}

export async function loadMetricBundle(tenantId: string, period: string): Promise<MetricBundle> {
  const rows = await listMetricValuesForPeriod(tenantId, 'month', period);
  return new MetricBundle(rows);
}
