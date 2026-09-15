import { count, pct, money, monthLabel } from '../../../lib/format';
import { scope, latestMonth } from '../scope';

export const dynamic = 'force-dynamic';

export default async function CustomersPage() {
  const { tenantId } = await scope();
  const m = await latestMonth(tenantId);

  if (!m.period) {
    return (
      <>
        <h1 className="gl-h1">Customers</h1>
        <div className="gl-empty mt-4">
          Your customer figures appear here once a full month of data has been processed.
        </div>
      </>
    );
  }

  const orders = m.num('order_count');
  const newCust = m.num('new_customer_count');
  const returning = orders === null || newCust === null ? null : Math.max(0, orders - newCust);
  const curNcr = m.tenant('new_customer_revenue')?.currency ?? 'USD';

  const stats = [
    { k: 'New customers', v: count(newCust), d: 'first order this month' },
    { k: 'Returning orders', v: count(returning), d: 'from customers you already had' },
    {
      k: 'New-customer sales',
      v: money(m.num('new_customer_revenue'), curNcr),
      d: pct(m.num('new_customer_revenue_share'), 0) + ' of sales',
    },
  ];
  const repeat = [
    { k: 'Came back within 30 days', v: pct(m.num('repeat_rate_30d')) },
    { k: 'Within 60 days', v: pct(m.num('repeat_rate_60d')) },
    { k: 'Within 90 days', v: pct(m.num('repeat_rate_90d')) },
  ];

  return (
    <>
      <div className="mb-4">
        <h1 className="gl-h1">Customers</h1>
        <p className="gl-sub mt-1.5">
          Who bought, and whether they came back — {monthLabel(m.period)}.
        </p>
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

      <div className="gl-panel">
        <div className="gl-phead">
          <h2>How many came back</h2>
          <div className="gl-meta">of this month&rsquo;s new customers</div>
        </div>
        {repeat.map((r) => (
          <div className="gl-mini" key={r.k}>
            <span>{r.k}</span>
            <span className="gl-v">{r.v}</span>
          </div>
        ))}
      </div>
    </>
  );
}
