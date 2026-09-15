import type { ReactNode } from 'react';
import { listConnections } from '@grossline/db';
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
  // Stale-sync notice (§8.10): tell the merchant when a connection needs
  // attention so an old-looking figure has an explanation.
  const connections = await listConnections(session.activeTenantId);
  const staleSync = connections.some((c) => c.health === 'degraded' || c.health === 'broken');

  return (
    <div>
      {session.viewAs ? (
        <div
          role="status"
          style={{
            background: 'var(--gl-gold-soft)',
            color: 'var(--gl-gold)',
            padding: '8px 26px',
            fontSize: 13,
            fontWeight: 500,
            borderBottom: '1px solid var(--gl-line)',
          }}
        >
          Viewing as {active?.tenantName ?? 'this merchant'} — read-only. Nothing you do here is
          saved. Use “Exit” to leave.
        </div>
      ) : null}
      <header
        className="gl-header"
        style={{ borderBottom: '1px solid var(--gl-line)', background: 'var(--gl-white)' }}
      >
        <div className="gl-htitle">
          <span className="gl-h1" style={{ fontSize: 20 }}>
            Grossline
          </span>
          {multi && !session.viewAs ? (
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
              {session.viewAs ? 'Exit' : 'Sign out'}
            </button>
          </form>
        </div>
      </header>
      <PortalNav />
      {staleSync ? (
        <div role="status" className="gl-pad" style={{ paddingTop: 12, paddingBottom: 0 }}>
          <div className="gl-empty" style={{ marginBottom: 0 }}>
            One of your connected accounts needs attention, so a few recent figures may be out of
            date. We&rsquo;re on it — see Settings for details.
          </div>
        </div>
      ) : null}
      <main className="gl-pad">{children}</main>
    </div>
  );
}
