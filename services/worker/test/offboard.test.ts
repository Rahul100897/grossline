import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { eq } from 'drizzle-orm';
import {
  closeDbPools,
  createTenant,
  getTenant,
  offboardTenant,
  recordReconciliationRun,
  schema,
  upsertReportSnapshot,
  withTenant,
} from '@grossline/db';

// task 5.B7 — offboarding revokes connections and deletes the tenant's data on a
// single action, then marks the tenant churned. Runs on a throwaway tenant.
let tenantId: string;
const period = '2026-08-01';

beforeAll(async () => {
  tenantId = (
    await createTenant({
      name: 'Offboard Brand',
      slug: `offboard-${randomUUID().slice(0, 8)}`,
      reportingCurrency: 'USD',
      reportingTimezone: 'UTC',
      status: 'trial',
    })
  ).id;

  // Seed representative tenant-scoped rows across the deletion order.
  await withTenant(tenantId, async (tx) => {
    await tx.insert(schema.findings).values({
      tenantId,
      period,
      ruleId: 'payback_broken',
      severity: 'attention',
      family: 'waste',
      metric: 'blended_cac',
      entity: 'account',
      entityKey: 'account',
      entityLabel: 'Whole account',
      moneyImpactMinor: 1000,
      status: 'new',
      firstSeenPeriod: period,
      currency: 'USD',
    });
    await tx.insert(schema.metricValues).values({
      tenantId,
      metric: 'net_sales',
      grain: 'month',
      period,
      scope: '',
      value: '100000',
      currency: 'USD',
    });
    await tx.insert(schema.credentials).values({
      tenantId,
      provider: 'shopify',
      ciphertext: 'x',
      iv: 'y',
      keyVersion: 1,
    });
  });
  await upsertReportSnapshot(tenantId, period, { tenantName: 'Offboard Brand' });
  await recordReconciliationRun(tenantId, period, 'ok', '5 within');
});

afterAll(async () => {
  await closeDbPools();
});

async function count(table: { tenantId: unknown }): Promise<number> {
  const rows = await withTenant(tenantId, (tx) =>
    // @ts-expect-error drizzle table typing across a generic helper
    tx.select().from(table).where(eq(table.tenantId, tenantId)),
  );
  return rows.length;
}

describe('offboard tenant (task 5.B7)', () => {
  it('has data before offboarding', async () => {
    expect(await count(schema.findings)).toBe(1);
    expect(await count(schema.metricValues)).toBe(1);
    expect(await count(schema.reports)).toBe(1);
    expect(await count(schema.reconciliationRuns)).toBe(1);
    expect(await count(schema.credentials)).toBe(1);
  });

  it('deletes all data and marks the tenant churned', async () => {
    await offboardTenant(tenantId);
    expect(await count(schema.findings)).toBe(0);
    expect(await count(schema.metricValues)).toBe(0);
    expect(await count(schema.reports)).toBe(0);
    expect(await count(schema.reconciliationRuns)).toBe(0);
    expect(await count(schema.credentials)).toBe(0);

    const tenant = await getTenant(tenantId);
    expect(tenant?.status).toBe('churned');
    expect(tenant?.monthlyFeeMinor).toBeNull();
  });
});
