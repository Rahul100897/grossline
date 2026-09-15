import type { ReactNode } from 'react';
import { requirePortalSession } from '../../lib/session';
import { logout } from '../login/actions';
import { switchTenant } from './actions';
import { PortalNav } from './nav';

// Resolves the session on every request (revocation / disabled / membership are
// enforced here), renders the tenant switcher from memberships only, and hands
// the active tenant down. Pages read the tenant from the session, never the URL.
export default async function AppLayout({ children }: { children: ReactNode }) {
  const session = await requirePortalSession();
  const active = session.memberships.find((m) => m.tenantId === session.activeTenantId);
  const multi = session.memberships.length > 1;

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
          {multi ? (
            <form action={switchTenant}>
              <select
                name="tenantId"
                defaultValue={session.activeTenantId}
                className="gl-switch"
                aria-label="Switch business"
              >
                {session.memberships.map((m) => (
                  <option key={m.tenantId} value={m.tenantId}>
                    {m.tenantName}
                  </option>
                ))}
              </select>{' '}
              <button type="submit" className="gl-btn ghost sm">
                Switch
              </button>
            </form>
          ) : active ? (
            <span className="gl-sub">{active.tenantName}</span>
          ) : null}
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
      <PortalNav />
      <main className="gl-pad">{children}</main>
    </div>
  );
}
