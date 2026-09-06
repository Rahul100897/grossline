'use server';

import { z } from 'zod';
import { requireSession } from '../../lib/auth';
import { intakeTicket } from '../../lib/ticket-intake';

const schema = z.object({
  type: z.enum(['bug', 'question', 'feedback', 'feature']),
  subject: z.string().min(1).max(300),
  body: z.string().min(1).max(20_000),
});

/**
 * In-app bug/feedback widget intake (task 3.7). Authenticated — the analyst's
 * own bug log while building — so it lands as an in_app ticket with no
 * submitter, alongside marketing-site tickets in the same inbox.
 */
export async function submitInAppTicket(
  input: unknown,
): Promise<{ ok: true } | { ok: false; error: string }> {
  await requireSession();
  const parsed = schema.safeParse(input);
  if (!parsed.success) {
    return { ok: false, error: parsed.error.issues[0]?.message ?? 'invalid' };
  }
  try {
    await intakeTicket({
      type: parsed.data.type,
      source: 'in_app',
      subject: parsed.data.subject,
      body: parsed.data.body,
    });
    return { ok: true };
  } catch (error) {
    return { ok: false, error: error instanceof Error ? error.message : 'could not save' };
  }
}
