'use server';

import { redirect } from 'next/navigation';
import { z } from 'zod';
import { decimalToMinorUnits } from '@grossline/core';
import { updateSettings, upsertBusinessProfile, writeAuditLog } from '@grossline/db';
import { requireSession } from '../../../lib/auth';

/** Plan rows come in as parallel arrays plan[]/fee[]/currency[]. */
export async function savePlans(formData: FormData): Promise<void> {
  const session = await requireSession();
  const names = formData.getAll('plan').map(String);
  const fees = formData.getAll('fee').map(String);
  const currencies = formData.getAll('currency').map(String);

  let failure: string | null = null;
  try {
    const plans = names
      .map((name, i) => ({ name: name.trim(), fee: (fees[i] ?? '').trim(), currency: (currencies[i] ?? 'USD').trim().toUpperCase() }))
      .filter((p) => p.name !== '' && p.fee !== '')
      .map((p) => ({
        plan: p.name,
        monthlyFeeMinor: decimalToMinorUnits(p.fee, p.currency),
        currency: p.currency,
      }));
    await updateSettings({ plans });
    await writeAuditLog({ actor: session.sub, action: 'settings.plans' });
  } catch (error) {
    failure = error instanceof Error ? (error.message.split('\n')[0] ?? error.message) : 'could not save';
  }
  if (failure !== null) redirect(`/settings/plans?error=${encodeURIComponent(failure)}`);
  redirect('/settings/plans?saved=1');
}

export async function saveThresholds(formData: FormData): Promise<void> {
  const session = await requireSession();
  const schema = z.object({
    costCompletenessPct: z.coerce.number().min(0).max(100),
    onboardingStaleDays: z.coerce.number().int().min(1),
  });
  let failure: string | null = null;
  try {
    const data = schema.parse({
      costCompletenessPct: formData.get('costCompletenessPct'),
      onboardingStaleDays: formData.get('onboardingStaleDays'),
    });
    await updateSettings({
      thresholds: {
        costCompleteness: data.costCompletenessPct / 100,
        onboardingStaleDays: data.onboardingStaleDays,
      },
    });
    await writeAuditLog({ actor: session.sub, action: 'settings.thresholds' });
  } catch (error) {
    failure = error instanceof Error ? (error.message.split('\n')[0] ?? error.message) : 'could not save';
  }
  if (failure !== null) redirect(`/settings/thresholds?error=${encodeURIComponent(failure)}`);
  redirect('/settings/thresholds?saved=1');
}

export async function saveAlerts(formData: FormData): Promise<void> {
  const session = await requireSession();
  await updateSettings({
    alerts: {
      emailOnNewTicket: formData.get('emailOnNewTicket') === 'on',
      emailOnBlockingIssue: formData.get('emailOnBlockingIssue') === 'on',
    },
  });
  await writeAuditLog({ actor: session.sub, action: 'settings.alerts' });
  redirect('/settings/alerts?saved=1');
}

export async function saveBusiness(formData: FormData): Promise<void> {
  const session = await requireSession();
  const field = (name: string): string => String(formData.get(name) ?? '').trim();
  const orNull = (v: string): string | null => (v === '' ? null : v);
  let failure: string | null = null;
  try {
    if (field('legalName') === '') throw new Error('legal name is required');
    await upsertBusinessProfile({
      legalName: field('legalName'),
      addressLines: orNull(field('addressLines')),
      gstin: orNull(field('gstin')),
      lutNumber: orNull(field('lutNumber')),
      invoiceEmail: orNull(field('invoiceEmail')),
      bankDetails: orNull(field('bankDetails')),
      footer: orNull(field('footer')),
    });
    await writeAuditLog({ actor: session.sub, action: 'settings.business' });
  } catch (error) {
    failure = error instanceof Error ? (error.message.split('\n')[0] ?? error.message) : 'could not save';
  }
  if (failure !== null) redirect(`/settings/business?error=${encodeURIComponent(failure)}`);
  redirect('/settings/business?saved=1');
}
