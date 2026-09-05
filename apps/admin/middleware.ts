// Everything except /login (and Next internals) requires a valid session.
// Session verification uses Web Crypto only, so it runs on the edge runtime.
import { NextResponse, type NextRequest } from 'next/server';
import { verifySessionToken } from '@grossline/core/auth/session';
import { SESSION_COOKIE } from './lib/constants';

export async function middleware(request: NextRequest): Promise<NextResponse> {
  const secret = process.env.SESSION_SECRET;
  const token = request.cookies.get(SESSION_COOKIE)?.value;
  const session = secret && token ? await verifySessionToken(token, secret) : null;
  if (!session) {
    const login = new URL('/login', request.url);
    return NextResponse.redirect(login);
  }
  return NextResponse.next();
}

export const config = {
  matcher: ['/((?!login|_next/static|_next/image|favicon.ico).*)'],
};
