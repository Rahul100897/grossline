// First gate: a valid, signed, unexpired portal cookie must be present. The
// authoritative check (revoked / disabled / membership) is done in the layout on
// the Node runtime against the database — a revoked session passes this edge
// check but is refused there on its very next request. This middleware only ever
// reads the portal cookie, so an admin session is never accepted here.
import { NextResponse, type NextRequest } from 'next/server';
import { verifySessionToken } from '@grossline/core/auth/session';
import { PORTAL_SESSION_COOKIE } from './lib/constants';

export async function middleware(request: NextRequest): Promise<NextResponse> {
  const secret = process.env.SESSION_SECRET;
  const token = request.cookies.get(PORTAL_SESSION_COOKIE)?.value;
  const ok = secret && token ? await verifySessionToken(token, secret) : null;
  if (!ok) {
    return NextResponse.redirect(new URL('/login', request.url));
  }
  return NextResponse.next();
}

export const config = {
  // /login and the invite-acceptance/reset pages authenticate on their own; the
  // rest of the portal needs a session.
  matcher: ['/((?!login|accept|reset|view-as|_next/static|_next/image|favicon.ico).*)'],
};
