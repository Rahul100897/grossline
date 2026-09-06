'use server';

import { redirect } from 'next/navigation';
import { z } from 'zod';
import { decimalToMinorUnits } from '@grossline/core';
import { createInvoice, writeAuditLog } from '@grossline/db';
import { requireSession } from '../../../../lib/auth';

const lineSchema = z.object({
  description: z.string().min(1),
  periodStart: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  periodEnd: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  amount: z.string(),
});

const formSchema = z.object({
  tenantId: z.string().uuid(),
  currency: z.string().length(3),
  issuedOn: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  dueOn: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  notes: z.string(),
});

export async function createInvoiceAction(formData: FormData): Promise<void> {
  const session = await requireSession();
  const field = (name: string): string => String(formData.get(name) ?? '').trim();
  const tenantId = field('tenantId');
  const back = `/billing/new?tenant=${tenantId}`;

  let invoiceId: string | null = null;
  let failure: string | null = null;
  try {
    const base = formSchema.parse({
      tenantId,
      currency: field('currency').toUpperCase(),
      issuedOn: field('issuedOn'),
      dueOn: field('dueOn'),
      notes: field('notes'),
    });

    // Up to three period lines; a line with a blank amount is skipped, so the
    // analyst can bill one, two or three months of a quarter.
    const lines = [0, 1, 2]
      .map((i) => ({
        description: field(`line_${i}_description`),
        periodStart: field(`line_${i}_periodStart`),
        periodEnd: field(`line_${i}_periodEnd`),
        amount: field(`line_${i}_amount`),
      }))
      .filter((l) => l.amount !== '' && l.description !== '')
      .map((l) => lineSchema.parse(l));

    if (lines.length === 0) throw new Error('add at least one line with an amount');

    const invoice = await createInvoice({
      tenantId: base.tenantId,
      currency: base.currency,
      issuedOn: base.issuedOn,
      dueOn: base.dueOn,
      notes: base.notes || null,
      lines: lines.map((l) => ({
        description: l.description,
        periodStart: l.periodStart,
        periodEnd: l.periodEnd,
        amountMinor: decimalToMinorUnits(l.amount, base.currency),
      })),
    });
    invoiceId = invoice.id;
    await writeAuditLog({
      actor: session.sub,
      action: 'invoice.create',
      tenantId: base.tenantId,
      subject: invoice.number,
    });
  } catch (error) {
    failure = error instanceof Error ? (error.message.split('\n')[0] ?? error.message) : 'could not create';
  }
  if (failure !== null || invoiceId === null) {
    redirect(`${back}&error=${encodeURIComponent(failure ?? 'could not create')}`);
  }
  redirect(`/billing/invoice/${invoiceId}?tenant=${tenantId}`);
}
