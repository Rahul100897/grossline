// Data assembly for the merchants list (docs/phase-3.md task 3.3). Reads only:
// stores, connections and stored metric values per tenant.
import {
  getMetricValues,
  listConnections,
  listStores,
  listTenants,
  type Connection,
  type Tenant,
} from '@grossline/db';

export type MerchantHealth =
  | { kind: 'none' } // no connections yet
  | { kind: 'demo' } // only seeded connections
  | { kind: 'health'; health: string };

export type MerchantRow = {
  tenant: Tenant;
  storeCount: number;
  health: MerchantHealth;
  /** Ad spend for the last full calendar month, from stored metric values. */
  adSpendLastMonth: { minor: number; currency: string } | null;
};

/** First day of the previous calendar month, as the metric layer keys periods. */
export function lastMonthPeriod(now: Date = new Date()): string {
  const year = now.getUTCFullYear();
  const month = now.getUTCMonth(); // 0-based; previous month is month-1
  const d = new Date(Date.UTC(year, month - 1, 1));
  return d.toISOString().slice(0, 10);
}

const HEALTH_RANK: Record<string, number> = { broken: 0, degraded: 1, unknown: 2, healthy: 3 };

export function worstHealth(connections: Connection[]): MerchantHealth {
  if (connections.length === 0) return { kind: 'none' };
  const real = connections.filter(
    (c) => ((c.settings ?? {}) as Record<string, unknown>).demo !== true,
  );
  if (real.length === 0) return { kind: 'demo' };
  const worst = real.reduce((a, b) =>
    (HEALTH_RANK[a.health] ?? 0) <= (HEALTH_RANK[b.health] ?? 0) ? a : b,
  );
  return { kind: 'health', health: worst.health };
}

export async function loadMerchantRows(now: Date = new Date()): Promise<MerchantRow[]> {
  const period = lastMonthPeriod(now);
  const tenants = await listTenants();
  const rows: MerchantRow[] = [];
  for (const tenant of tenants) {
    const [stores, connections, spendRows] = await Promise.all([
      listStores(tenant.id),
      listConnections(tenant.id),
      getMetricValues(tenant.id, { metric: 'total_ad_spend', grain: 'month', periods: [period] }),
    ]);
    const spend = spendRows[0];
    rows.push({
      tenant,
      storeCount: stores.length,
      health: worstHealth(connections),
      adSpendLastMonth:
        spend && spend.currency !== null
          ? { minor: Number(spend.value), currency: spend.currency }
          : null,
    });
  }
  return rows;
}

export function filterMerchants(
  rows: MerchantRow[],
  query: { q?: string; plan?: string; status?: string },
): MerchantRow[] {
  const q = query.q?.trim().toLowerCase();
  return rows.filter((row) => {
    if (q && !`${row.tenant.name} ${row.tenant.slug}`.toLowerCase().includes(q)) return false;
    if (query.plan && (row.tenant.plan ?? 'none') !== query.plan) return false;
    if (query.status && row.tenant.status !== query.status) return false;
    return true;
  });
}
