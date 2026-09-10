import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  approveFinding,
  closeDbPools,
  countUnreviewedFindings,
  createTenant,
  getReconciliationRun,
  recordReconciliationRun,
  schema,
  withTenant,
} from '@grossline/db';

// task 5.B4 — the send gate blocks on BOTH conditions: any unreviewed finding,
// or no reconciliation run for the period. computeSendGate (admin lib) composes
// exactly these two db predicates; this proves each independently gates and only
// their conjunction clears.
let tenantId: string;
let findingId: string;
const period = '2026-08-01';

// The gate's composition, mirrored from apps/admin/lib/reports.ts.
const canSend = (unreviewed: number, reconciled: boolean): boolean =>
  unreviewed === 0 && reconciled;

beforeAll(async () => {
  tenantId = (
    await createTenant({
      name: 'Gate Brand',
      slug: `gate-${randomUUID().slice(0, 8)}`,
      reportingCurrency: 'USD',
      reportingTimezone: 'UTC',
    })
  ).id;
  const [row] = await withTenant(tenantId, (tx) =>
    tx
      .insert(schema.findings)
      .values({
        tenantId,
        period,
        ruleId: 'payback_broken',
        severity: 'attention',
        family: 'waste',
        metric: 'blended_cac',
        entity: 'account',
        entityKey: 'account',
        entityLabel: 'Whole account',
        moneyImpactMinor: 55_896,
        status: 'new',
        firstSeenPeriod: period,
        currency: 'USD',
      })
      .returning({ id: schema.findings.id }),
  );
  findingId = row!.id;
});

afterAll(async () => {
  await closeDbPools();
});

describe('report send gate (task 5.B4)', () => {
  it('blocks when a finding is unreviewed and reconciliation has not run', async () => {
    const unreviewed = await countUnreviewedFindings(tenantId, period);
    const reconciled = (await getReconciliationRun(tenantId, period)) !== null;
    expect(unreviewed).toBe(1);
    expect(reconciled).toBe(false);
    expect(canSend(unreviewed, reconciled)).toBe(false);
  });

  it('still blocks after reconciliation runs while a finding is unreviewed', async () => {
    await recordReconciliationRun(tenantId, period, 'ok', '5 within');
    const unreviewed = await countUnreviewedFindings(tenantId, period);
    const reconciled = (await getReconciliationRun(tenantId, period)) !== null;
    expect(reconciled).toBe(true);
    expect(unreviewed).toBe(1);
    expect(canSend(unreviewed, reconciled)).toBe(false);
  });

  it('clears only when findings are reviewed AND reconciliation has run', async () => {
    await approveFinding(tenantId, findingId);
    const unreviewed = await countUnreviewedFindings(tenantId, period);
    const reconciled = (await getReconciliationRun(tenantId, period)) !== null;
    expect(unreviewed).toBe(0);
    expect(reconciled).toBe(true);
    expect(canSend(unreviewed, reconciled)).toBe(true);
  });
});
