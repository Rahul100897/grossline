import { money, count, ratio, monthLabel } from '../../lib/format';
import { scope, latestMonth } from './scope';

export const dynamic = 'force-dynamic';

export default async function ThisMonthPage() {
  const { tenantId } = await scope();
  const m = await latestMonth(tenantId);
  const cur = (metric: string): string => m.tenant(metric)?.currency ?? 'USD';

  if (!m.period) {
    return (
      <>
        <h1 className="gl-h1">This month</h1>
        <div className="gl-empty mt-4">
          Your first month of figures will appear here once we have processed a full month of your
          store&rsquo;s data.
        </div>
      </>
    );
  }

  const stats = [
    {
      k: 'What you sold',
      v: money(m.num('net_sales'), cur('net_sales')),
      d: 'net of discounts and returns',
    },
    { k: 'Orders', v: count(m.num('order_count')), d: 'this month' },
    {
      k: 'What you kept',
      v: money(m.num('contribution_after_ad_spend'), cur('contribution_after_ad_spend')),
      d: 'after every cost we can see',
    },
    {
      k: 'For every $1 on ads',
      v: ratio(m.num('mer')),
      d: `this came back${m.num('mer') === null ? '' : ' — break-even lower is worse'}`,
    },
    {
      k: 'What a new customer cost',
      v: money(m.num('blended_cac'), cur('blended_cac')),
      d: 'to acquire',
    },
    { k: 'Average order', v: money(m.num('aov'), cur('aov')), d: 'across the month' },
  ];

  return (
    <>
      <div className="mb-4">
        <h1 className="gl-h1">This month</h1>
        <p className="gl-sub mt-1.5">{monthLabel(m.period)}</p>
      </div>

      <div className="gl-strip" style={{ gridTemplateColumns: 'repeat(3, 1fr)' }}>
        {stats.map((s) => (
          <div className="gl-stat" key={s.k}>
            <div className="gl-k">{s.k}</div>
            <div className="gl-v">{s.v}</div>
            <div className="gl-d">{s.d}</div>
          </div>
        ))}
      </div>

      <p className="gl-note">
        These are the headline figures. Your full monthly report — what changed, where the numbers
        disagree, and what is worth changing — is in your Reports tab.
      </p>
    </>
  );
}
