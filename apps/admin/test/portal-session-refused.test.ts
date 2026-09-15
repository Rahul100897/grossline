// Phase 8 §8.5: a merchant session must be refused on every admin route. The
// admin and portal are separate apps with separate cookies, so the admin
// middleware only ever reads the admin cookie — a portal cookie is simply not an
// admin session. This enumerates admin routes and proves each redirects to the
// admin login when presented with no admin cookie or a portal cookie.
import { describe, expect, it } from 'vitest';
import { NextRequest } from 'next/server';
import { middleware } from '../middleware';

const ADMIN_ROUTES = [
  '/',
  '/merchants',
  '/merchants/00000000-0000-0000-0000-000000000000',
  '/merchants/00000000-0000-0000-0000-000000000000/access',
  '/findings',
  '/reports',
  '/billing',
  '/issues',
  '/connections',
  '/settings',
  '/support',
];

function request(path: string, cookies: Record<string, string> = {}): NextRequest {
  const req = new NextRequest(new URL(`http://localhost:3000${path}`));
  for (const [name, value] of Object.entries(cookies)) req.cookies.set(name, value);
  return req;
}

function isLoginRedirect(res: Response): boolean {
  return (
    res.status >= 300 && res.status < 400 && (res.headers.get('location') ?? '').includes('/login')
  );
}

describe('admin refuses non-admin sessions on every route (Phase 8 §8.5)', () => {
  for (const path of ADMIN_ROUTES) {
    it(`redirects ${path} with no session`, async () => {
      expect(isLoginRedirect(await middleware(request(path)))).toBe(true);
    });

    it(`refuses ${path} carrying a portal cookie`, async () => {
      const res = await middleware(
        request(path, { grossline_portal_session: 'a.merchant.cookie.value' }),
      );
      expect(isLoginRedirect(res)).toBe(true);
    });
  }
});
