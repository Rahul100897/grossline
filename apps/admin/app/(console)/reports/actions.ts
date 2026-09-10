'use server';

import { redirect } from 'next/navigation';
import { z } from 'zod';
import {
  getReport,
  getTenant,
  markReportApproved,
  markReportSent,
  writeAuditLog,
} from '@grossline/db';
import { buildAndSaveReport, renderStoredReport } from '@grossline/worker/reports-pipeline';
import { REPORT_PDF_OPTIONS } from '@grossline/worker/report-html';
import { requireSession } from '../../../lib/auth';
import { computeSendGate } from '../../../lib/reports';
import { htmlToPdf } from '../../../lib/pdf';
import { sendEmail } from '../../../lib/email';

const back = (tenantId: string, period: string, extra = ''): string =>
  `/reports?tenant=${tenantId}&period=${period}${extra}`;

async function tenantPeriod(formData: FormData): Promise<{ tenantId: string; period: string }> {
  return {
    tenantId: z.string().uuid().parse(formData.get('tenantId')),
    period: z
      .string()
      .regex(/^\d{4}-\d{2}-\d{2}$/)
      .parse(formData.get('period')),
  };
}

export async function buildReport(formData: FormData): Promise<void> {
  const session = await requireSession();
  const { tenantId, period } = await tenantPeriod(formData);
  let failure: string | null = null;
  try {
    await buildAndSaveReport(tenantId, period);
    await writeAuditLog({ actor: session.sub, action: 'report.build', tenantId, subject: period });
  } catch (error) {
    failure = error instanceof Error ? (error.message.split('\n')[0] ?? error.message) : 'build failed';
  }
  redirect(failure ? back(tenantId, period, `&error=${encodeURIComponent(failure)}`) : back(tenantId, period, '&saved=1'));
}

export async function approveReport(formData: FormData): Promise<void> {
  const session = await requireSession();
  const { tenantId, period } = await tenantPeriod(formData);
  const report = await getReport(tenantId, period);
  if (report) {
    await markReportApproved(tenantId, report.id);
    await writeAuditLog({ actor: session.sub, action: 'report.approve', tenantId, subject: period });
  }
  redirect(back(tenantId, period, '&saved=1'));
}

export async function sendReport(formData: FormData): Promise<void> {
  const session = await requireSession();
  const { tenantId, period } = await tenantPeriod(formData);
  const recipientsRaw = String(formData.get('recipients') ?? '');
  const recipients = recipientsRaw
    .split(/[\s,;]+/)
    .map((r) => r.trim())
    .filter((r) => /^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(r));

  const report = await getReport(tenantId, period);
  if (!report) redirect(back(tenantId, period, `&error=${encodeURIComponent('Build the report first.')}`));

  // The send gate: nothing goes out unreviewed or unreconciled.
  const gate = await computeSendGate(tenantId, period);
  if (!gate.canSend) {
    redirect(back(tenantId, period, `&error=${encodeURIComponent(gate.reasons.join(' '))}`));
  }
  if (recipients.length === 0) {
    redirect(back(tenantId, period, `&error=${encodeURIComponent('Enter at least one valid recipient email.')}`));
  }

  const tenant = await getTenant(tenantId);
  let emailNote = 'recorded as sent';
  try {
    const pdf = await htmlToPdf(renderStoredReport(report!), REPORT_PDF_OPTIONS);
    const result = await sendEmail({
      to: recipients,
      subject: `${tenant?.name ?? 'Your'} monthly report — ${period.slice(0, 7)}`,
      text: 'Your monthly report is attached.',
      attachments: [{ filename: `report-${period.slice(0, 7)}.pdf`, content: pdf.toString('base64') }],
    });
    emailNote = result.sent ? 'emailed' : `recorded as sent (email not sent: ${result.reason ?? 'unknown'})`;
  } catch (error) {
    emailNote = `recorded as sent (PDF/email failed: ${error instanceof Error ? error.message : 'unknown'})`;
  }

  await markReportSent(tenantId, report!.id, recipients);
  await writeAuditLog({
    actor: session.sub,
    action: 'report.send',
    tenantId,
    subject: period,
    metadata: { recipients, emailNote },
  });
  redirect(back(tenantId, period, `&saved=${encodeURIComponent(emailNote)}`));
}
