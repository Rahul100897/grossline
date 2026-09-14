'use server';

import { redirect } from 'next/navigation';
import { z } from 'zod';
import { consumeTokenAndSetPassword, getMerchantUserById, writeAuditLog } from '@grossline/db';

const schema = z
  .object({
    token: z.string().min(1),
    password: z.string().min(10),
    confirm: z.string(),
  })
  .refine((v) => v.password === v.confirm);

export async function resetPassword(formData: FormData): Promise<void> {
  const parsed = schema.safeParse({
    token: formData.get('token'),
    password: formData.get('password'),
    confirm: formData.get('confirm'),
  });
  if (!parsed.success) {
    const token = String(formData.get('token') ?? '');
    redirect(`/reset/${encodeURIComponent(token)}?error=1`);
  }
  const { token, password } = parsed.data;

  // Consuming the token sets the password AND revokes every existing session
  // (the reset ends other sessions — §8.4).
  const userId = await consumeTokenAndSetPassword(token, 'reset', password);
  if (!userId) redirect(`/reset/${encodeURIComponent(token)}?expired=1`);

  const user = await getMerchantUserById(userId);
  await writeAuditLog({
    actor: user?.email ?? userId,
    action: 'merchant.password_reset',
    subject: userId,
  });
  redirect('/login?reset=1');
}
