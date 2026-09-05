import { cookies } from 'next/headers';
import { redirect } from 'next/navigation';
import { verifySessionToken, type SessionPayload } from '@grossline/core/auth/session';
import { SESSION_COOKIE } from './constants';

/**
 * Local-dev convenience: ADMIN_TOTP_DISABLED=true skips the authenticator
 * step. Deliberately inert in production — TOTP is always required there.
 */
export function totpDisabled(): boolean {
  return process.env.ADMIN_TOTP_DISABLED === 'true' && process.env.NODE_ENV !== 'production';
}

export function sessionSecret(): string {
  const secret = process.env.SESSION_SECRET;
  if (!secret) throw new Error('SESSION_SECRET is not set');
  return secret;
}

export async function getSession(): Promise<SessionPayload | null> {
  const token = (await cookies()).get(SESSION_COOKIE)?.value;
  if (!token) return null;
  return verifySessionToken(token, sessionSecret());
}

/** Defense in depth behind the middleware: pages re-check the session. */
export async function requireSession(): Promise<SessionPayload> {
  const session = await getSession();
  if (!session) redirect('/login');
  return session;
}
