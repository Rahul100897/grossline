import type { ReactNode } from 'react';
import { requirePortalSession } from '../../lib/session';
import { logout } from '../login/actions';

// Every page under (app) is behind this layout, which resolves the session
// (revocation / disabled / membership are enforced here on every request) and
// hands the active tenant down. Pages read the tenant from the session, never
// from the URL.
export default async function AppLayout({ children }: { children: ReactNode }) {
  const session = await requirePortalSession();
  const active = session.memberships.find((m) => m.tenantId === session.activeTenantId);

  return (
    <div>
      <header
        className="gl-header"
        style={{ borderBottom: '1px solid var(--gl-line)', background: 'var(--gl-white)' }}
      >
        <div className="gl-htitle">
          <span className="gl-h1" style={{ fontSize: 20 }}>
            Grossline
          </span>
          {active ? <span className="gl-sub">{active.tenantName}</span> : null}
          {session.user.isDemo ? <span className="gl-tag warn">Demo</span> : null}
        </div>
        <div className="gl-hactions">
          <span className="gl-sub">{session.user.name}</span>
          <form action={logout}>
            <button type="submit" className="gl-btn ghost sm">
              Sign out
            </button>
          </form>
        </div>
      </header>
      <main className="gl-pad">{children}</main>
    </div>
  );
}
