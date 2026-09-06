// Shared ticket intake used by both the public marketing-site route and the
// in-app widget action (task 3.7). Creates the ticket, then notifies the
// analyst by email (best-effort — a failed notification never fails intake:
// the ticket is already saved and visible in the inbox).
import 'server-only';
import { createTicket, type CreateTicketInput, type Ticket } from '@grossline/db';
import { adminNotifyAddress, sendEmail } from './email';

export async function intakeTicket(input: CreateTicketInput): Promise<Ticket> {
  const ticket = await createTicket(input);

  const to = adminNotifyAddress();
  if (to) {
    await sendEmail({
      to,
      subject: `[Grossline ${ticket.type}] ${ticket.subject}`,
      text: [
        `A ${ticket.type} ticket arrived via ${ticket.source}.`,
        '',
        `Subject: ${ticket.subject}`,
        ticket.submitterName ? `From: ${ticket.submitterName}` : null,
        ticket.submitterEmail ? `Email: ${ticket.submitterEmail}` : null,
        '',
        ticket.body,
      ]
        .filter((l) => l !== null)
        .join('\n'),
      replyTo: ticket.submitterEmail ?? undefined,
    });
    // Result intentionally ignored — see module comment.
  }
  return ticket;
}
