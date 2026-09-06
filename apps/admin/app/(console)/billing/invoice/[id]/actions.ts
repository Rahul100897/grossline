'use server';

import { redirect } from 'next/navigation';
import { z } from 'zod';
import { decimalToMinorUnits } from '@grossline/core';
import { recordPayment, updateInvoiceStatus, writeAuditLog } from '@grossline/db';
import { requireSession } from '../../../../../lib/auth';

const statusSchema = z.object({
  tenantId: z.string().uuid(),
  invoiceId: z.string().uuid(),
  status: z.enum(['draft', 'sent', 'paid', 'void']),
});

export async function setInvoiceStatus(formData: FormData): Promise<void> {
  const session = await requireSession();
  const data = statusSchema.parse({
    tenantId: formData.get('tenantId'),
    invoiceId: formData.get('invoiceId'),
    status: formData.get('status'),
  });
  await updateInvoiceStatus(data.tenantId, data.invoiceId, data.status);
  await writeAuditLog({
    actor: session.sub,
    action: 'invoice.status',
    tenantId: data.tenantId,
    subject: data.status,
  });
  redirect(`/billing/invoice/${data.invoiceId}?tenant=${data.tenantId}&saved=1`);
}

const paymentSchema = z.object({
  tenantId: z.string().uuid(),
  invoiceId: z.string().uuid(),
  grossCurrency: z.string().length(3),
});

export async function recordPaymentAction(formData: FormData): Promise<void> {
  const session = await requireSession();
  const field = (name: string): string => String(formData.get(name) ?? '').trim();
  const base = paymentSchema.parse({
    tenantId: field('tenantId'),
    invoiceId: field('invoiceId'),
    grossCurrency: field('grossCurrency').toUpperCase(),
  });
  const back = `/billing/invoice/${base.invoiceId}?tenant=${base.tenantId}`;

  let failure: string | null = null;
  try {
    const gross = field('gross');
    if (gross === '') throw new Error('gross amount is required');
    const xflow = field('xflowFee');
    const netInr = field('netInr');
    await recordPayment({
      tenantId: base.tenantId,
      invoiceId: base.invoiceId,
      grossMinor: decimalToMinorUnits(gross, base.grossCurrency),
      grossCurrency: base.grossCurrency,
      xflowFeeMinor: xflow === '' ? null : decimalToMinorUnits(xflow, base.grossCurrency),
      netInrMinor: netInr === '' ? null : decimalToMinorUnits(netInr, 'INR'),
      fxRate: field('fxRate') || null,
      receivedOn: field('receivedOn'),
      reference: field('reference') || null,
      markPaid: field('markPaid') === 'on',
    });
    await writeAuditLog({
      actor: session.sub,
      action: 'invoice.payment',
      tenantId: base.tenantId,
      subject: base.invoiceId,
    });
  } catch (error) {
    failure = error instanceof Error ? (error.message.split('\n')[0] ?? error.message) : 'could not record';
  }
  if (failure !== null) redirect(`${back}&error=${encodeURIComponent(failure)}`);
  redirect(`${back}&saved=1`);
}
