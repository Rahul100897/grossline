'use server';

import { redirect } from 'next/navigation';
import { z } from 'zod';
import { setActiveTenant } from '@grossline/db';
import { requirePortalSession } from '../../lib/session';

/** Switch the active tenant. setActiveTenant validates the target against the
 *  user's memberships, so a tampered value selects nothing. */
export async function switchTenant(formData: FormData): Promise<void> {
  const session = await requirePortalSession();
  const parsed = z.string().uuid().safeParse(formData.get('tenantId'));
  if (parsed.success) await setActiveTenant(session.sessionId, parsed.data);
  redirect('/');
}
