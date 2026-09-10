import { randomUUID } from 'node:crypto';
import { afterAll, describe, expect, it } from 'vitest';
import { closeDbPools, createTicket, listTickets } from '@grossline/db';

// task 5.C3 — the free-first-report request lands in the same tickets inbox with
// its own type. This proves the type is accepted and filterable.
afterAll(async () => {
  await closeDbPools();
});

describe('free-report intake (task 5.C3)', () => {
  it('accepts a free_report ticket and it is filterable by type', async () => {
    const store = `store-${randomUUID().slice(0, 8)}.myshopify.com`;
    const ticket = await createTicket({
      type: 'free_report',
      source: 'marketing',
      subject: `Free first report — ${store}`,
      body: `Store: ${store}\nMonthly ad spend: $20k across Google + Meta`,
      submitterEmail: 'founder@example.com',
    });
    expect(ticket.type).toBe('free_report');

    const inbox = await listTickets({ type: 'free_report' });
    expect(inbox.some((t) => t.id === ticket.id)).toBe(true);
  });
});
