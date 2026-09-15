import { cookies } from 'next/headers';
import { NextResponse, type NextRequest } from 'next/server';
import { createSessionToken } from '@grossline/core/auth/session';
import { consumeViewAsToken, createViewAsSession } from '@grossline/db';
import { PORTAL_SESSION_COOKIE } from '../../../lib/constants';
import { sessionSecret } from '../../../lib/session';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

const VIEWAS_TTL_MS = 30 * 60 * 1000;

// Admin view-as handoff (§8.8): exchange a single-use token for a short-lived,
// read-only session pinned to the chosen tenant. Public (outside the session
// gate) because it authenticates via the token itself.
export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ token: string }> },
): Promise<Response> {
  const { token } = await params;
  const tenantId = req.nextUrl.searchParams.get('tenant') ?? '';
  const userId = await consumeViewAsToken(token);
  if (!userId) return NextResponse.redirect(new URL('/login', req.url));

  const sessionId = await createViewAsSession(userId, tenantId, VIEWAS_TTL_MS);
  if (!sessionId) return NextResponse.redirect(new URL('/login', req.url));

  const signed = await createSessionToken(
    { sub: sessionId, exp: Date.now() + VIEWAS_TTL_MS },
    sessionSecret(),
  );
  (await cookies()).set(PORTAL_SESSION_COOKIE, signed, {
    httpOnly: true,
    sameSite: 'lax',
    secure: process.env.NODE_ENV === 'production',
    path: '/',
    maxAge: VIEWAS_TTL_MS / 1000,
  });
  return NextResponse.redirect(new URL('/', req.url));
}
