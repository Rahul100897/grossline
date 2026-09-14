'use server';

import { cookies } from 'next/headers';
import { redirect } from 'next/navigation';
import { z } from 'zod';
import { createSessionToken, verifySessionToken } from '@grossline/core/auth/session';
import {
  verifyMerchantLogin,
  createMerchantSession,
  revokeMerchantSession,
  writeAuditLog,
} from '@grossline/db';
import { PORTAL_SESSION_COOKIE, PORTAL_SESSION_TTL_MS } from '../../lib/constants';
import { sessionSecret } from '../../lib/session';

const loginSchema = z.object({
  email: z.string().email(),
  password: z.string().min(1),
});

export async function login(formData: FormData): Promise<void> {
  const parsed = loginSchema.safeParse({
    email: formData.get('email'),
    password: formData.get('password'),
  });
  if (!parsed.success) redirect('/login?error=1');
  const { email, password } = parsed.data;

  const user = await verifyMerchantLogin(email, password);
  if (!user) {
    // One generic failure path; reveal nothing about which factor or whether the
    // account exists.
    await writeAuditLog({ actor: email, action: 'merchant.login_failed' });
    redirect('/login?error=1');
  }

  // Rotate: kill any session the presented cookie still points at, so an old
  // identifier stops working the moment a new one is issued.
  const jar = await cookies();
  const existing = jar.get(PORTAL_SESSION_COOKIE)?.value;
  if (existing) {
    const prev = await verifySessionToken(existing, sessionSecret());
    if (prev) await revokeMerchantSession(prev.sub);
  }

  const sessionId = await createMerchantSession(user.id);
  const token = await createSessionToken(
    { sub: sessionId, exp: Date.now() + PORTAL_SESSION_TTL_MS },
    sessionSecret(),
  );
  jar.set(PORTAL_SESSION_COOKIE, token, {
    httpOnly: true,
    sameSite: 'lax',
    secure: process.env.NODE_ENV === 'production',
    path: '/',
    maxAge: PORTAL_SESSION_TTL_MS / 1000,
  });
  await writeAuditLog({ actor: user.email, action: 'merchant.login', subject: user.id });
  redirect('/');
}

export async function logout(): Promise<void> {
  const jar = await cookies();
  const token = jar.get(PORTAL_SESSION_COOKIE)?.value;
  if (token) {
    const payload = await verifySessionToken(token, sessionSecret());
    if (payload) await revokeMerchantSession(payload.sub);
  }
  jar.delete(PORTAL_SESSION_COOKIE);
  redirect('/login');
}
