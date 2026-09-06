'use server';

import { redirect } from 'next/navigation';
import { z } from 'zod';
import { decimalToMinorUnits } from '@grossline/core';
import { updateTenant, writeAuditLog } from '@grossline/db';
import { requireSession } from '../../../../../lib/auth';

const formSchema = z.object({
  tenantId: z.string().uuid(),
  plan: z.string(),
  status: z.enum(['onboarding', 'active', 'paused', 'churned']),
  monthlyFee: z.string(),
  feeCurrency: z.string().length(3),
  partnerRateUntil: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).or(z.literal('')),
});

export async function saveBilling(formData: FormData): Promise<void> {
  const session = await requireSession();
  const field = (name: string): string => String(formData.get(name) ?? '').trim();
  const tenantId = field('tenantId');
  const back = `/merchants/${tenantId}/billing`;

  let failure: string | null = null;
  try {
    const data = formSchema.parse({
      tenantId,
      plan: field('plan'),
      status: field('status'),
      monthlyFee: field('monthlyFee'),
      feeCurrency: field('feeCurrency').toUpperCase(),
      partnerRateUntil: field('partnerRateUntil'),
    });
    await updateTenant(tenantId, {
      plan: data.plan || null,
      status: data.status,
      // An empty fee means unpriced — stored as null, never as zero.
      monthlyFeeMinor:
        data.monthlyFee === '' ? null : decimalToMinorUnits(data.monthlyFee, data.feeCurrency),
      feeCurrency: data.feeCurrency,
      partnerRateUntil: data.partnerRateUntil === '' ? null : data.partnerRateUntil,
    });
    await writeAuditLog({ actor: session.sub, action: 'tenant.billing.update', tenantId });
  } catch (error) {
    failure = error instanceof Error ? (error.message.split('\n')[0] ?? error.message) : 'could not save';
  }
  if (failure !== null) redirect(`${back}?error=${encodeURIComponent(failure)}`);
  redirect(`${back}?saved=1`);
}
