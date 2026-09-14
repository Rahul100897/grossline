// The portal's single source of "who is this and which tenant can they see".
// The cookie is an HMAC-signed token (same primitive as admin) carrying a
// server-side session id; the authoritative check — revoked? expired? user
// active? which tenant? — is resolveMerchantSession against the database, run on
// every request. Nothing here trusts a tenant id from the client.
import { cookies } from 'next/headers';
import { redirect } from 'next/navigation';
import { verifySessionToken } from '@grossline/core/auth/session';
import { resolveMerchantSession, type ResolvedMerchantSession } from '@grossline/db';
import { PORTAL_SESSION_COOKIE } from './constants';

export function sessionSecret(): string {
  const secret = process.env.SESSION_SECRET;
  if (!secret) throw new Error('SESSION_SECRET is not set');
  return secret;
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
