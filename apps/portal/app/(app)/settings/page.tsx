import {
  listConnections,
  listTenantCostInputs,
  listTenantMerchantUsers,
  getTenant,
} from '@grossline/db';
import { scope } from '../scope';
import { reportProblem } from './actions';

export const dynamic = 'force-dynamic';

const PROVIDER_LABEL: Record<string, string> = {
  shopify: 'Shopify',
  meta: 'Meta',
  google_ads: 'Google Ads',
};
const HEALTH_TONE: Record<string, string> = {
  healthy: 'ok',
  degraded: 'warn',
  broken: 'bad',
  unknown: 'n',
};
const HEALTH_LABEL: Record<string, string> = {
  healthy: 'connected',
  degraded: 'needs attention',
  broken: 'disconnected',
  unknown: 'not yet synced',
};

export default async function SettingsPage({
  searchParams,
}: {
  searchParams: Promise<{ problem?: string }>;
}) {
  const { tenantId } = await scope();
  const { problem } = await searchParams;
  const [tenant, connections, costInputs, users] = await Promise.all([
    getTenant(tenantId),
    listConnections(tenantId),
    listTenantCostInputs(tenantId),
    listTenantMerchantUsers(tenantId),
  ]);

  return (
    <>
      <h1 className="gl-h1 mb-4">Settings</h1>

      {/* Connections — read-only. We show health, never tokens. */}
      <div className="gl-panel">
        <div className="gl-phead">
          <h2>Connections</h2>
          <div className="gl-meta">read-only — we maintain these</div>
        </div>
        {connections.length === 0 ? (
          <div className="gl-mini">
            <span className="gl-quiet">No accounts connected yet.</span>
          </div>
        ) : (
          connections.map((c) => (
            <div className="gl-li" key={c.id}>
              <b>{PROVIDER_LABEL[c.provider] ?? c.provider}</b>
              <span className="gl-r">
                <span className={`gl-tag ${HEALTH_TONE[c.health] ?? 'n'}`}>
                  {HEALTH_LABEL[c.health] ?? c.health}
                </span>
              </span>
            </div>
          ))
        )}
      </div>

      {/* Cost inputs — read-only; we maintain them. */}
      <div className="gl-panel">
        <div className="gl-phead">
          <h2>Product costs</h2>
          <div className="gl-meta">read-only — we maintain these</div>
        </div>
        <div className="gl-mini">
          <span>
            {costInputs.length > 0
              ? 'Cost information is on file and applied to your margin figures.'
              : 'No cost information on file yet — margin figures are shown as a floor until we add it.'}
          </span>
        </div>
      </div>

      {/* Users on this tenant. */}
      <div className="gl-panel">
        <div className="gl-phead">
          <h2>People with access</h2>
          <div className="gl-meta">{tenant?.name}</div>
        </div>
        {users.map((u) => (
          <div className="gl-li" key={u.userId}>
            <span>
              <b>{u.name}</b> <span className="gl-quiet">{u.email}</span>
            </span>
            <span className="gl-r">{u.role}</span>
          </div>
        ))}
        <div className="gl-foot">
          To add or remove someone, reply to your monthly report email or use “Report a problem”
          below.
        </div>
      </div>

      {/* Report a problem → tickets inbox. */}
      <div className="gl-panel">
        <div className="gl-phead">
          <h2>Report a problem</h2>
        </div>
        <div style={{ padding: 19 }}>
          {problem === 'sent' ? (
            <div className="gl-empty" style={{ color: 'var(--gl-green)', marginBottom: 12 }}>
              Thanks — we&rsquo;ve got it and will get back to you.
            </div>
          ) : problem === 'error' ? (
            <div className="gl-error">Please add a subject and a message.</div>
          ) : null}
          <form action={reportProblem} className="flex flex-col gap-2" style={{ maxWidth: 520 }}>
            <label className="flex flex-col gap-1 text-meta">
              Subject
              <input name="subject" required className="gl-input" />
            </label>
            <label className="flex flex-col gap-1 text-meta">
              What&rsquo;s wrong?
              <textarea name="body" required rows={4} className="gl-input" />
            </label>
            <button type="submit" className="gl-btn" style={{ alignSelf: 'flex-start' }}>
              Send
            </button>
          </form>
        </div>
      </div>
    </>
  );
}
