'use server';

import { redirect } from 'next/navigation';
import { z } from 'zod';
import { createTicket, writeAuditLog } from '@grossline/db';
import { requirePortalSession } from '../../../lib/session';

const schema = z.object({
  subject: z.string().min(1).max(200),
  body: z.string().min(1).max(5000),
});

/** "Report a problem" writes to the admin tickets inbox, tagged in-app and scoped
 *  to the session's tenant and user — the merchant supplies nothing about who
 *  they are or which tenant it is. */
export async function reportProblem(formData: FormData): Promise<void> {
  const session = await requirePortalSession();
  const parsed = schema.safeParse({
    subject: formData.get('subject'),
    body: formData.get('body'),
  });
  if (!parsed.success) redirect('/settings?problem=error');

  await createTicket({
    type: 'question',
    source: 'in_app',
    subject: parsed.data.subject,
    body: parsed.data.body,
    submitterName: session.user.name,
    submitterEmail: session.user.email,
    tenantId: session.activeTenantId,
  });
  await writeAuditLog({
    actor: session.user.email,
    action: 'merchant.reported_problem',
    tenantId: session.activeTenantId,
    subject: session.user.id,
  });
  redirect('/settings?problem=sent');
}
