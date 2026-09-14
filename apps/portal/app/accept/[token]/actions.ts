'use server';

import { redirect } from 'next/navigation';
import { z } from 'zod';
import { consumeTokenAndSetPassword, getMerchantUserById, writeAuditLog } from '@grossline/db';
import { establishSession } from '../../../lib/session';

const schema = z
  .object({
    token: z.string().min(1),
    password: z.string().min(10, 'at least 10 characters'),
    confirm: z.string(),
  })
  .refine((v) => v.password === v.confirm, { message: 'passwords do not match' });

export async function acceptInvite(formData: FormData): Promise<void> {
  const parsed = schema.safeParse({
    token: formData.get('token'),
    password: formData.get('password'),
    confirm: formData.get('confirm'),
  });
  if (!parsed.success) {
    const token = String(formData.get('token') ?? '');
    redirect(`/accept/${encodeURIComponent(token)}?error=1`);
  }
  const { token, password } = parsed.data;

  const userId = await consumeTokenAndSetPassword(token, 'invite', password);
  if (!userId) redirect(`/accept/${encodeURIComponent(token)}?expired=1`);

  const user = await getMerchantUserById(userId);
  await writeAuditLog({
    actor: user?.email ?? userId,
    action: 'merchant.invite_accepted',
    subject: userId,
  });
  // Land them straight in the portal.
  await establishSession(userId);
  redirect('/');
}
