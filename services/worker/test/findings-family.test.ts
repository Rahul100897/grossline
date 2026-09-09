import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { closeDbPools, createTenant, schema, withTenant } from '@grossline/db';

// task 5.A1 — the database enforces money_impact XOR opportunity_value with a
// check constraint (findings_value_exclusive). This proves a finding row cannot
// carry both values, and that each single-value shape is accepted.
let tenantId: string;

const base = {
  ruleId: 'below_break_even_mer',
  severity: 'attention',
  metric: 'mer',
  entity: 'account',
  entityKey: 'account',
  entityLabel: 'Whole account',
  status: 'new' as const,
  period: '2026-08-01',
  firstSeenPeriod: '2026-08-01',
  currency: 'USD',
};

beforeAll(async () => {
  tenantId = (
    await createTenant({
      name: 'Family tenant',
      slug: `family-${randomUUID().slice(0, 8)}`,
      reportingCurrency: 'USD',
      reportingTimezone: 'UTC',
    })
  ).id;
});

afterAll(async () => {
  await closeDbPools();
});

describe('findings check constraint — money_impact XOR opportunity_value', () => {
  it('rejects a row carrying both a money impact and an opportunity value', async () => {
    await expect(
      withTenant(tenantId, (tx) =>
        tx.insert(schema.findings).values({
          tenantId,
          ...base,
          family: 'growth',
          moneyImpactMinor: 120_000,
          opportunityValueMinor: 250_000,
        }),
      ),
    ).rejects.toThrow();
  });

  it('accepts a waste row (money impact, no opportunity)', async () => {
    await expect(
      withTenant(tenantId, (tx) =>
        tx.insert(schema.findings).values({
          tenantId,
          ...base,
          entityKey: 'account:waste',
          family: 'waste',
          moneyImpactMinor: 120_000,
          opportunityValueMinor: null,
        }),
      ),
    ).resolves.toBeDefined();
  });

  it('accepts a growth row (zero money impact, an opportunity value)', async () => {
    await expect(
      withTenant(tenantId, (tx) =>
        tx.insert(schema.findings).values({
          tenantId,
          ...base,
          entityKey: 'account:growth',
          family: 'growth',
          moneyImpactMinor: 0,
          opportunityValueMinor: 250_000,
        }),
      ),
    ).resolves.toBeDefined();
  });
});
