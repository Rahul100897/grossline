'use server';

import { cookies } from 'next/headers';
import { redirect } from 'next/navigation';
import { z } from 'zod';
import { verifyPassword, verifyTotp } from '@grossline/core';
import { createSessionToken } from '@grossline/core/auth/session';
import { getAdminUserByEmail, writeAuditLog } from '@grossline/db';
import { SESSION_COOKIE, SESSION_TTL_MS } from '../../lib/constants';
import { sessionSecret, totpDisabled } from '../../lib/auth';

const loginSchema = z.object({
  email: z.string().email(),
  password: z.string().min(1),
  // null when the field is hidden by ADMIN_TOTP_DISABLED; verified below.
  totp: z.string().nullish(),
});

export async function login(formData: FormData): Promise<void> {
  const parsed = loginSchema.safeParse({
    email: formData.get('email'),
    password: formData.get('password'),
    totp: formData.get('totp'),
  });
  // One generic failure path: never reveal which factor was wrong.
  if (!parsed.success) redirect('/login?error=1');

  const { email, password, totp } = parsed.data;
  const user = await getAdminUserByEmail(email);
  const passwordOk = user ? verifyPassword(password, user.passwordHash) : false;
  const totpOk = totpDisabled() ? true : user ? verifyTotp(user.totpSecret, totp ?? '') : false;

  if (!user || !passwordOk || !totpOk) {
    await writeAuditLog({ actor: email, action: 'admin.login_failed' });
    redirect('/login?error=1');
  }

  await writeAuditLog({ actor: user.email, action: 'admin.login' });
  const token = await createSessionToken(
    { sub: user.id, exp: Date.now() + SESSION_TTL_MS },
    sessionSecret(),
  );
  (await cookies()).set(SESSION_COOKIE, token, {
    httpOnly: true,
    sameSite: 'lax',
    secure: process.env.NODE_ENV === 'production',
    path: '/',
    maxAge: SESSION_TTL_MS / 1000,
  });
  redirect('/');
}

export async function logout(): Promise<void> {
  (await cookies()).delete(SESSION_COOKIE);
  redirect('/login');
}
