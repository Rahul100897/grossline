'use server';

import { redirect } from 'next/navigation';
import { z } from 'zod';
import { decimalToMinorUnits } from '@grossline/core';
import { upsertTenantCostInputs } from '@grossline/db';
import { requireSession } from '../../../../lib/auth';

const formSchema = z.object({
  tenantId: z.string().uuid(),
  effectiveFrom: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  currency: z.string().length(3),
});

/** '' → null; percent like "2.9" → 290 basis points, no float arithmetic. */
function percentToBp(raw: string): number | null {
  if (raw.trim() === '') return null;
  return decimalToMinorUnits(raw, 'USD'); // 2 decimals: 1bp resolution
}

function moneyToMinor(raw: string, currency: string): number | null {
  if (raw.trim() === '') return null;
  return decimalToMinorUnits(raw, currency);
}

export async function saveCostInputs(formData: FormData): Promise<void> {
  await requireSession();
  const base = formSchema.parse({
    tenantId: formData.get('tenantId'),
    effectiveFrom: formData.get('effectiveFrom'),
    currency: String(formData.get('currency') ?? '').toUpperCase(),
  });
  const field = (name: string): string => String(formData.get(name) ?? '');

  try {
    await upsertTenantCostInputs(base.tenantId, {
      effectiveFrom: base.effectiveFrom,
      currency: base.currency,
      paymentFeeBp: percentToBp(field('paymentFeePercent')),
      paymentFeeFixedMinor: moneyToMinor(field('paymentFeeFixed'), base.currency),
      shippingCostPerOrderMinor: moneyToMinor(field('shippingCost'), base.currency),
      fulfilmentCostPerOrderMinor: moneyToMinor(field('fulfilmentCost'), base.currency),
      packagingCostPerOrderMinor: moneyToMinor(field('packagingCost'), base.currency),
      monthlyRevenueTargetMinor: moneyToMinor(field('monthlyRevenueTarget'), base.currency),
      monthlySpendTargetMinor: moneyToMinor(field('monthlySpendTarget'), base.currency),
    });
  } catch {
    redirect(`/tenants/${base.tenantId}/costs?error=1`);
  }
  redirect(`/tenants/${base.tenantId}/costs?saved=1`);
}
