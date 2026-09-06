'use server';

import { redirect } from 'next/navigation';
import { z } from 'zod';
import { decimalToMinorUnits } from '@grossline/core';
import { createTenant, updateTenant, writeAuditLog } from '@grossline/db';
import { requireSession } from '../../../../lib/auth';

const formSchema = z.object({
  name: z.string().min(1),
  slug: z.string().regex(/^[a-z0-9-]+$/, 'slug must be lowercase kebab-case'),
  reportingCurrency: z.string().length(3),
  reportingTimezone: z.string().min(1),
  status: z.enum(['onboarding', 'active', 'paused', 'churned']),
  plan: z.string(),
  monthlyFee: z.string(),
  feeCurrency: z.string().length(3),
});

export async function createMerchant(formData: FormData): Promise<void> {
  const session = await requireSession();
  const field = (name: string): string => String(formData.get(name) ?? '').trim();

  let tenantId: string;
  try {
    const data = formSchema.parse({
      name: field('name'),
      slug: field('slug'),
      reportingCurrency: field('reportingCurrency').toUpperCase(),
      reportingTimezone: field('reportingTimezone'),
      status: field('status'),
      plan: field('plan'),
      monthlyFee: field('monthlyFee'),
      feeCurrency: (field('feeCurrency') || field('reportingCurrency')).toUpperCase(),
    });

    const tenant = await createTenant({
      name: data.name,
      slug: data.slug,
      reportingCurrency: data.reportingCurrency,
      reportingTimezone: data.reportingTimezone,
      status: data.status,
      plan: data.plan || undefined,
    });
    tenantId = tenant.id;

    if (data.monthlyFee !== '') {
      await updateTenant(tenant.id, {
        monthlyFeeMinor: decimalToMinorUnits(data.monthlyFee, data.feeCurrency),
        feeCurrency: data.feeCurrency,
      });
    }

    await writeAuditLog({
      actor: session.sub,
      action: 'tenant.create',
      tenantId: tenant.id,
      subject: data.slug,
    });
  } catch (error) {
    const message = error instanceof Error ? (error.message.split('\n')[0] ?? error.message) : 'could not create';
    redirect(`/merchants/new?error=${encodeURIComponent(message)}`);
  }
  redirect(`/merchants/${tenantId}`);
}
