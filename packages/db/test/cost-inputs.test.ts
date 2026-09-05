import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createTenant } from '../src/admin';
import { closeDbPools } from '../src/client';
import {
  getCostInputsEffectiveOn,
  listTenantCostInputs,
  upsertTenantCostInputs,
} from '../src/cost-inputs';

let tenantId: string;

beforeAll(async () => {
  tenantId = (
    await createTenant({
      name: 'Cost inputs tenant',
      slug: `costin-${randomUUID().slice(0, 8)}`,
      reportingCurrency: 'USD',
      reportingTimezone: 'UTC',
    })
  ).id;
});

afterAll(async () => {
  await closeDbPools();
});

describe('merchant cost inputs (task 2.2 done-when)', () => {
  it('a later change never affects a historical month', async () => {
    await upsertTenantCostInputs(tenantId, {
      effectiveFrom: '2026-01-01',
      currency: 'USD',
      paymentFeeBp: 290, // 2.90%
      paymentFeeFixedMinor: 30,
      shippingCostPerOrderMinor: 650,
      fulfilmentCostPerOrderMinor: 280,
      packagingCostPerOrderMinor: 90,
      monthlyRevenueTargetMinor: 12_000_000,
      monthlySpendTargetMinor: 2_500_000,
    });
    // …months later the processor renegotiates:
    await upsertTenantCostInputs(tenantId, {
      effectiveFrom: '2026-06-01',
      currency: 'USD',
      paymentFeeBp: 310,
      paymentFeeFixedMinor: 30,
      shippingCostPerOrderMinor: 700,
    });

    const march = await getCostInputsEffectiveOn(tenantId, '2026-03-15');
    expect(march).toMatchObject({
      effectiveFrom: '2026-01-01',
      paymentFeeBp: 290,
      shippingCostPerOrderMinor: 650,
      packagingCostPerOrderMinor: 90,
    });

    const july = await getCostInputsEffectiveOn(tenantId, '2026-07-01');
    expect(july).toMatchObject({ effectiveFrom: '2026-06-01', paymentFeeBp: 310 });
    // The June snapshot did not supply packaging — missing, not inherited, not zero.
    expect(july!.packagingCostPerOrderMinor).toBeNull();
  });

  it('before any snapshot there are no inputs — missing, never defaults', async () => {
    expect(await getCostInputsEffectiveOn(tenantId, '2025-12-31')).toBeNull();
  });

  it('saving the same effective date replaces the snapshot', async () => {
    await upsertTenantCostInputs(tenantId, {
      effectiveFrom: '2026-01-01',
      currency: 'USD',
      paymentFeeBp: 295,
    });
    const rows = (await listTenantCostInputs(tenantId)).filter(
      (r) => r.effectiveFrom === '2026-01-01',
    );
    expect(rows).toHaveLength(1);
    expect(rows[0]!.paymentFeeBp).toBe(295);
  });

  it('rejects nonsense values loudly', async () => {
    await expect(
      upsertTenantCostInputs(tenantId, {
        effectiveFrom: '2026-01-01',
        currency: 'USD',
        paymentFeeBp: 20_000, // 200% payment fee is a typo, not a fee
      }),
    ).rejects.toThrow();
  });
});
