'use server';

import { redirect } from 'next/navigation';
import { z } from 'zod';
import { addTicketReply, getTicketWithMessages, updateTicket, writeAuditLog } from '@grossline/db';
import { requireSession } from '../../../../lib/auth';
import { sendEmail } from '../../../../lib/email';

export async function replyToTicket(formData: FormData): Promise<void> {
  const session = await requireSession();
  const ticketId = z.string().uuid().parse(formData.get('ticketId'));
  const body = String(formData.get('body') ?? '').trim();
  const close = String(formData.get('close') ?? '') === 'on';
  const back = `/support/${ticketId}`;

  if (body === '') redirect(`${back}?error=${encodeURIComponent('reply cannot be empty')}`);

  const ticket = await getTicketWithMessages(ticketId);
  if (!ticket) redirect('/support');

  // Email the submitter if we have an address; record whether it actually sent.
  let emailed = false;
  let emailNote = '';
  if (ticket!.submitterEmail) {
    const result = await sendEmail({
      to: ticket!.submitterEmail,
      subject: `Re: ${ticket!.subject}`,
      text: body,
    });
    emailed = result.sent;
    if (!result.sent) emailNote = ` (email not sent: ${result.reason})`;
  }

  await addTicketReply({ ticketId, author: 'admin', body, emailed });
  await updateTicket(ticketId, { status: close ? 'closed' : 'in_progress' });
  await writeAuditLog({ actor: session.sub, action: 'ticket.reply', subject: ticketId });

  redirect(`${back}?saved=1${emailNote ? `&error=${encodeURIComponent(emailNote.trim())}` : ''}`);
}

export async function updateTicketMeta(formData: FormData): Promise<void> {
  const session = await requireSession();
  const schema = z.object({
    ticketId: z.string().uuid(),
    status: z.enum(['open', 'in_progress', 'closed']).optional(),
    priority: z.enum(['low', 'normal', 'high']).optional(),
    notes: z.string().max(20_000).optional(),
  });
  const data = schema.parse({
    ticketId: formData.get('ticketId'),
    status: formData.get('status') || undefined,
    priority: formData.get('priority') || undefined,
    notes: formData.get('notes') ?? undefined,
  });
  await updateTicket(data.ticketId, {
    status: data.status,
    priority: data.priority,
    notes: data.notes !== undefined ? (data.notes.trim() === '' ? null : data.notes) : undefined,
  });
  await writeAuditLog({ actor: session.sub, action: 'ticket.update', subject: data.ticketId });
  redirect(`/support/${data.ticketId}?saved=1`);
}
