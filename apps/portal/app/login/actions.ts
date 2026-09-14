'use server';

import { cookies, headers } from 'next/headers';
import { redirect } from 'next/navigation';
import { z } from 'zod';
import { createSessionToken, verifySessionToken } from '@grossline/core/auth/session';
import {
  verifyMerchantLogin,
  createMerchantSession,
  revokeMerchantSession,
  recordLoginAttempt,
  isLoginLocked,
  writeAuditLog,
} from '@grossline/db';
import { PORTAL_SESSION_COOKIE, PORTAL_SESSION_TTL_MS } from '../../lib/constants';
import { sessionSecret } from '../../lib/session';

const loginSchema = z.object({
  email: z.string().email(),
  password: z.string().min(1),
});

async function clientIp(): Promise<string> {
  const h = await headers();
  return (h.get('x-forwarded-for')?.split(',')[0]?.trim() || h.get('x-real-ip') || 'unknown').slice(
    0,
    64,
  );
}

export async function login(formData: FormData): Promise<void> {
  const parsed = loginSchema.safeParse({
    email: formData.get('email'),
    password: formData.get('password'),
  });
  if (!parsed.success) redirect('/login?error=1');
  const { email, password } = parsed.data;
  const ip = await clientIp();

  // Rate limit: once an email or IP has too many recent failures, refuse without
  // even checking the password. Same generic error so it reveals nothing.
  if (await isLoginLocked(email, ip)) {
    await writeAuditLog({ actor: email, action: 'merchant.login_locked', metadata: { ip } });
    redirect('/login?error=1');
  }

  const user = await verifyMerchantLogin(email, password);
  if (!user) {
    // One generic failure path; reveal nothing about which factor or whether the
    // account exists.
    await recordLoginAttempt(email, ip, false);
    await writeAuditLog({ actor: email, action: 'merchant.login_failed', metadata: { ip } });
    redirect('/login?error=1');
  }
  await recordLoginAttempt(email, ip, true);

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
