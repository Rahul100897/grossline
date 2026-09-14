// The portal's single source of "who is this and which tenant can they see".
// The cookie is an HMAC-signed token (same primitive as admin) carrying a
// server-side session id; the authoritative check — revoked? expired? user
// active? which tenant? — is resolveMerchantSession against the database, run on
// every request. Nothing here trusts a tenant id from the client.
import { cookies } from 'next/headers';
import { redirect } from 'next/navigation';
import { createSessionToken, verifySessionToken } from '@grossline/core/auth/session';
import {
  createMerchantSession,
  resolveMerchantSession,
  type ResolvedMerchantSession,
} from '@grossline/db';
import { PORTAL_SESSION_COOKIE, PORTAL_SESSION_TTL_MS } from './constants';

export function sessionSecret(): string {
  const secret = process.env.SESSION_SECRET;
  if (!secret) throw new Error('SESSION_SECRET is not set');
  return secret;
}

/** Create a fresh server-side session for a user and set the signed cookie. Used
 *  by login and by invite/reset acceptance. */
export async function establishSession(userId: string): Promise<void> {
  const sessionId = await createMerchantSession(userId);
  const token = await createSessionToken(
    { sub: sessionId, exp: Date.now() + PORTAL_SESSION_TTL_MS },
    sessionSecret(),
  );
  (await cookies()).set(PORTAL_SESSION_COOKIE, token, {
    httpOnly: true,
    sameSite: 'lax',
    secure: process.env.NODE_ENV === 'production',
    path: '/',
    maxAge: PORTAL_SESSION_TTL_MS / 1000,
  });
}

export async function getPortalSession(): Promise<ResolvedMerchantSession | null> {
  const token = (await cookies()).get(PORTAL_SESSION_COOKIE)?.value;
  if (!token) return null;
  const payload = await verifySessionToken(token, sessionSecret());
  if (!payload) return null;
  // payload.sub is the server-side session id, not a user or tenant id.
  return resolveMerchantSession(payload.sub);
}

/** Every portal page and action calls this. The returned session carries the
 *  active tenant; pass that (never a URL value) to tenant-scoped queries. */
export async function requirePortalSession(): Promise<ResolvedMerchantSession> {
  const session = await getPortalSession();
  if (!session) redirect('/login');
  return session;
}
