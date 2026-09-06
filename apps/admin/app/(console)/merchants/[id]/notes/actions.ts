'use server';

import { redirect } from 'next/navigation';
import { z } from 'zod';
import { updateTenant, writeAuditLog } from '@grossline/db';
import { requireSession } from '../../../../../lib/auth';

const formSchema = z.object({
  tenantId: z.string().uuid(),
  notes: z.string().max(50_000),
});

export async function saveNotes(formData: FormData): Promise<void> {
  const session = await requireSession();
  const data = formSchema.parse({
    tenantId: formData.get('tenantId'),
    notes: String(formData.get('notes') ?? ''),
  });
  const back = `/merchants/${data.tenantId}/notes`;

  let failed = false;
  try {
    await updateTenant(data.tenantId, { notes: data.notes.trim() === '' ? null : data.notes });
    await writeAuditLog({ actor: session.sub, action: 'tenant.notes.update', tenantId: data.tenantId });
  } catch {
    failed = true;
  }
  if (failed) redirect(`${back}?error=${encodeURIComponent('could not save notes')}`);
  redirect(`${back}?saved=1`);
}
