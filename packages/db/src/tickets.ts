// Support tickets data access (docs/phase-3.md task 3.7). tenant_id is
// nullable and marketing-site submissions are unauthenticated, so tickets and
// their reply thread live on the admin connection (like audit_log), not under
// tenant RLS. Intake validation happens here so the public route stays thin.
import { and, desc, eq } from 'drizzle-orm';
import { z } from 'zod';
import { adminDb } from './client';
import { ticketMessages, tickets } from './schema';

export type Ticket = typeof tickets.$inferSelect;
export type TicketMessage = typeof ticketMessages.$inferSelect;
export type TicketWithMessages = Ticket & { messages: TicketMessage[] };

const createTicketSchema = z.object({
  type: z.enum(['bug', 'question', 'feedback', 'feature']),
  source: z.enum(['marketing', 'in_app']),
  subject: z.string().min(1).max(300),
  body: z.string().min(1).max(20_000),
  submitterName: z.string().max(200).nullable().optional(),
  submitterEmail: z.string().email().max(320).nullable().optional(),
  tenantId: z.string().uuid().nullable().optional(),
  priority: z.enum(['low', 'normal', 'high']).optional(),
});

export type CreateTicketInput = z.input<typeof createTicketSchema>;

export async function createTicket(input: CreateTicketInput): Promise<Ticket> {
  const data = createTicketSchema.parse(input);
  const [row] = await adminDb()
    .insert(tickets)
    .values({
      type: data.type,
      source: data.source,
      subject: data.subject,
      body: data.body,
      submitterName: data.submitterName ?? null,
      submitterEmail: data.submitterEmail ?? null,
      tenantId: data.tenantId ?? null,
      priority: data.priority ?? 'normal',
    })
    .returning();
  if (!row) throw new Error('ticket insert returned no row');
  return row;
}

export type TicketFilter = { status?: string; type?: string; priority?: string };

export async function listTickets(filter: TicketFilter = {}): Promise<Ticket[]> {
  const clauses = [
    filter.status ? eq(tickets.status, filter.status as Ticket['status']) : undefined,
    filter.type ? eq(tickets.type, filter.type as Ticket['type']) : undefined,
    filter.priority ? eq(tickets.priority, filter.priority as Ticket['priority']) : undefined,
  ].filter(Boolean);
  const where = clauses.length > 0 ? and(...(clauses as NonNullable<(typeof clauses)[number]>[])) : undefined;
  return adminDb()
    .select()
    .from(tickets)
    .where(where)
    .orderBy(desc(tickets.createdAt));
}

export async function countOpenTickets(): Promise<number> {
  const rows = await adminDb().select({ id: tickets.id }).from(tickets).where(eq(tickets.status, 'open'));
  return rows.length;
}

export async function getTicketWithMessages(ticketId: string): Promise<TicketWithMessages | null> {
  const [ticket] = await adminDb().select().from(tickets).where(eq(tickets.id, ticketId)).limit(1);
  if (!ticket) return null;
  const messages = await adminDb()
    .select()
    .from(ticketMessages)
    .where(eq(ticketMessages.ticketId, ticketId))
    .orderBy(ticketMessages.createdAt);
  return { ...ticket, messages };
}

export async function addTicketReply(input: {
  ticketId: string;
  author: 'admin' | 'submitter';
  body: string;
  emailed: boolean;
}): Promise<TicketMessage> {
  const body = z.string().min(1).max(20_000).parse(input.body);
  const [row] = await adminDb()
    .insert(ticketMessages)
    .values({ ticketId: input.ticketId, author: input.author, body, emailed: input.emailed })
    .returning();
  await adminDb().update(tickets).set({ updatedAt: new Date() }).where(eq(tickets.id, input.ticketId));
  if (!row) throw new Error('ticket message insert returned no row');
  return row;
}

export async function updateTicket(
  ticketId: string,
  patch: { status?: 'open' | 'in_progress' | 'closed'; priority?: 'low' | 'normal' | 'high'; notes?: string | null },
): Promise<void> {
  await adminDb()
    .update(tickets)
    .set({ ...patch, updatedAt: new Date() })
    .where(eq(tickets.id, ticketId));
}
