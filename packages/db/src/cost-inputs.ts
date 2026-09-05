import { asc, sql } from 'drizzle-orm';
import { z } from 'zod';
import { latestEffective } from '@grossline/core';
import { tenantCostInputs } from './schema';
import { withTenant } from './tenant-scope';

export type TenantCostInputs = typeof tenantCostInputs.$inferSelect;

const inputSchema = z.object({
  effectiveFrom: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  currency: z.string().length(3),
  paymentFeeBp: z.number().int().min(0).max(10_000).nullish(),
  paymentFeeFixedMinor: z.number().int().min(0).nullish(),
  shippingCostPerOrderMinor: z.number().int().min(0).nullish(),
  fulfilmentCostPerOrderMinor: z.number().int().min(0).nullish(),
  packagingCostPerOrderMinor: z.number().int().min(0).nullish(),
  monthlyRevenueTargetMinor: z.number().int().min(0).nullish(),
  monthlySpendTargetMinor: z.number().int().min(0).nullish(),
});

export type TenantCostInputsInput = z.input<typeof inputSchema>;

/** One snapshot per (tenant, effective_from); saving the same date replaces it. */
export async function upsertTenantCostInputs(
  tenantId: string,
  input: TenantCostInputsInput,
): Promise<TenantCostInputs> {
  const data = inputSchema.parse(input);
  const [row] = await withTenant(tenantId, (tx) =>
    tx
      .insert(tenantCostInputs)
      .values({
        tenantId,
        effectiveFrom: data.effectiveFrom,
        currency: data.currency.toUpperCase(),
        paymentFeeBp: data.paymentFeeBp ?? null,
        paymentFeeFixedMinor: data.paymentFeeFixedMinor ?? null,
        shippingCostPerOrderMinor: data.shippingCostPerOrderMinor ?? null,
        fulfilmentCostPerOrderMinor: data.fulfilmentCostPerOrderMinor ?? null,
        packagingCostPerOrderMinor: data.packagingCostPerOrderMinor ?? null,
        monthlyRevenueTargetMinor: data.monthlyRevenueTargetMinor ?? null,
        monthlySpendTargetMinor: data.monthlySpendTargetMinor ?? null,
      })
      .onConflictDoUpdate({
        target: [tenantCostInputs.tenantId, tenantCostInputs.effectiveFrom],
        set: {
          currency: sql`excluded.currency`,
          paymentFeeBp: sql`excluded.payment_fee_bp`,
          paymentFeeFixedMinor: sql`excluded.payment_fee_fixed_minor`,
          shippingCostPerOrderMinor: sql`excluded.shipping_cost_per_order_minor`,
          fulfilmentCostPerOrderMinor: sql`excluded.fulfilment_cost_per_order_minor`,
          packagingCostPerOrderMinor: sql`excluded.packaging_cost_per_order_minor`,
          monthlyRevenueTargetMinor: sql`excluded.monthly_revenue_target_minor`,
          monthlySpendTargetMinor: sql`excluded.monthly_spend_target_minor`,
          createdAt: sql`now()`,
        },
      })
      .returning(),
  );
  if (!row) throw new Error('cost inputs upsert returned no row');
  return row;
}

export async function listTenantCostInputs(tenantId: string): Promise<TenantCostInputs[]> {
  return withTenant(tenantId, (tx) =>
    tx.select().from(tenantCostInputs).orderBy(asc(tenantCostInputs.effectiveFrom)),
  );
}

/** The snapshot effective on a date — a later change never affects it. */
export async function getCostInputsEffectiveOn(
  tenantId: string,
  onDate: string,
): Promise<TenantCostInputs | null> {
  const rows = await listTenantCostInputs(tenantId);
  return latestEffective(rows, onDate);
}
