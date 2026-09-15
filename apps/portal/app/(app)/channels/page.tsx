import { money, pct, count, monthLabel } from '../../../lib/format';
import { scope, latestMonth } from '../scope';

export const dynamic = 'force-dynamic';

const LABELS: Record<string, string> = {
  meta: 'Meta',
  google_ads: 'Google',
};

export default async function ChannelsPage() {
  const { tenantId } = await scope();
  const m = await latestMonth(tenantId);

  // Rows scoped to a platform, keyed by `${metric}|${platform}`.
  const at = (metric: string, platform: string): number | null => {
    const row = m.rows.find((r) => r.metric === metric && r.scope === `platform:${platform}`);
    return row ? Number(row.value) : null;
  };
  const cur = (metric: string, platform: string): string =>
    m.rows.find((r) => r.metric === metric && r.scope === `platform:${platform}`)?.currency ??
    'USD';

  const platforms = [
    ...new Set(
      m.rows
        .filter((r) => r.scope.startsWith('platform:'))
        .map((r) => r.scope.slice('platform:'.length)),
    ),
  ].filter((p) => LABELS[p]);

  if (!m.period || platforms.length === 0) {
    return (
      <>
        <h1 className="gl-h1">Channels</h1>
        <div className="gl-empty mt-4">
          No ad-platform data for this period. Once your Meta or Google accounts are connected,
          you&rsquo;ll see what each spent and where their numbers disagree with your store.
        </div>
      </>
    );
  }

  return (
    <>
      <div className="mb-4">
        <h1 className="gl-h1">Channels</h1>
        <p className="gl-sub mt-1.5">
          What each ad platform claims, next to what your store recorded — {monthLabel(m.period)}.
        </p>
      </div>

      <div className="gl-panel">
        <div className="gl-tablewrap">
          <table className="gl-table">
            <thead>
              <tr>
                <th>Channel</th>
                <th className="gl-num">Spend</th>
                <th className="gl-num">Platform says</th>
                <th className="gl-num">Your store recorded</th>
                <th className="gl-num">Where they disagree</th>
              </tr>
            </thead>
            <tbody>
              {platforms.map((p) => {
                const gap = at('claim_gap', p);
                const claimedRaw = at('platform_conversions', p);
                const claimed = claimedRaw === null ? null : Math.round(claimedRaw);
                const store =
                  claimedRaw === null || gap === null ? null : Math.round(claimedRaw * (1 - gap));
                return (
                  <tr key={p}>
                    <td className="gl-strong">{LABELS[p]}</td>
                    <td className="gl-num">{money(at('ad_spend', p), cur('ad_spend', p))}</td>
                    <td className="gl-num">{count(claimed)} orders</td>
                    <td className="gl-num">{count(store)} orders</td>
                    <td className="gl-num">
                      {gap === null ? (
                        '—'
                      ) : (
                        <span
                          className={`gl-tag ${gap >= 0.25 ? 'bad' : gap >= 0.12 ? 'warn' : 'ok'}`}
                        >
                          {pct(gap, 0)}
                        </span>
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
        <div className="gl-foot">
          Each platform counts the same orders its own way, so their numbers can&rsquo;t be added
          together. Your store&rsquo;s own record is the independent check. A small gap is normal; a
          large one means budgets are being set on numbers that are too generous.
        </div>
      </div>
    </>
  );
}
