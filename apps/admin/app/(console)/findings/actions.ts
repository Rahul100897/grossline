'use server';

import { redirect } from 'next/navigation';
import { z } from 'zod';
import {
  approveFinding,
  dismissFinding,
  getFinding,
  reopenFinding,
  saveFindingText,
  unapproveFinding,
  writeAuditLog,
} from '@grossline/db';
import { runFindings } from '@grossline/worker/findings-pipeline';
import { requireSession } from '../../../lib/auth';

const back = (tenantId: string, period: string, extra = ''): string =>
  `/findings?tenant=${tenantId}&period=${period}${extra}`;

async function tenantPeriodFrom(formData: FormData): Promise<{ tenantId: string; period: string; id: string }> {
  return {
    tenantId: z.string().uuid().parse(formData.get('tenantId')),
    period: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).parse(formData.get('period')),
    id: z.string().uuid().parse(formData.get('id')),
  };
}

export async function approve(formData: FormData): Promise<void> {
  const session = await requireSession();
  const { tenantId, period, id } = await tenantPeriodFrom(formData);
  await approveFinding(tenantId, id);
  await writeAuditLog({ actor: session.sub, action: 'finding.approve', tenantId, subject: id });
  redirect(back(tenantId, period, '&saved=1'));
}

export async function unapprove(formData: FormData): Promise<void> {
  const session = await requireSession();
  const { tenantId, period, id } = await tenantPeriodFrom(formData);
  await unapproveFinding(tenantId, id);
  await writeAuditLog({ actor: session.sub, action: 'finding.unapprove', tenantId, subject: id });
  redirect(back(tenantId, period));
}

export async function dismiss(formData: FormData): Promise<void> {
  const session = await requireSession();
  const { tenantId, period, id } = await tenantPeriodFrom(formData);
  const deliberate = String(formData.get('deliberate') ?? '') === 'on';
  const reasonInput = String(formData.get('reason') ?? '').trim();
  const reason = reasonInput || (deliberate ? 'marked deliberate' : 'dismissed');
  await dismissFinding(tenantId, id, reason);
  await writeAuditLog({
    actor: session.sub,
    action: deliberate ? 'finding.deliberate' : 'finding.dismiss',
    tenantId,
    subject: id,
  });
  redirect(back(tenantId, period, '&saved=1'));
}

export async function reopen(formData: FormData): Promise<void> {
  const session = await requireSession();
  const { tenantId, period, id } = await tenantPeriodFrom(formData);
  await reopenFinding(tenantId, id);
  await writeAuditLog({ actor: session.sub, action: 'finding.reopen', tenantId, subject: id });
  redirect(back(tenantId, period));
}

export async function saveText(formData: FormData): Promise<void> {
  const session = await requireSession();
  const { tenantId, period, id } = await tenantPeriodFrom(formData);
  const finalText = z.string().max(20_000).parse(formData.get('finalText') ?? '');
  const finding = await getFinding(tenantId, id);
  if (!finding) redirect(back(tenantId, period));
  await saveFindingText(tenantId, id, finalText);
  await writeAuditLog({ actor: session.sub, action: 'finding.edit', tenantId, subject: id });
  redirect(back(tenantId, period, '&saved=1'));
}

export async function recompute(formData: FormData): Promise<void> {
  const session = await requireSession();
  const tenantId = z.string().uuid().parse(formData.get('tenantId'));
  const period = z.string().regex(/^\d{4}-\d{2}-\d{2}$/).parse(formData.get('period'));
  let failure: string | null = null;
  try {
    await runFindings(tenantId, period);
    await writeAuditLog({ actor: session.sub, action: 'findings.recompute', tenantId, subject: period });
  } catch (error) {
    failure = error instanceof Error ? (error.message.split('\n')[0] ?? error.message) : 'recompute failed';
  }
  if (failure !== null) redirect(back(tenantId, period, `&error=${encodeURIComponent(failure)}`));
  redirect(back(tenantId, period, '&saved=1'));
}
