import { count, pct, money, monthLabel } from '../../../lib/format';
import { scope, latestMonth } from '../scope';

export const dynamic = 'force-dynamic';

export default async function ProductsPage() {
  const { tenantId } = await scope();
  const m = await latestMonth(tenantId);

  if (!m.period) {
    return (
      <>
        <h1 className="gl-h1">Products</h1>
        <div className="gl-empty mt-4">
          Product figures appear here once a full month of data has been processed.
        </div>
      </>
    );
  }

  const curGs = m.tenant('gross_sales')?.currency ?? 'USD';
  const stats = [
    { k: 'Units sold', v: count(m.num('units')), d: 'across all orders' },
    {
      k: 'Units per order',
      v: m.num('units_per_order') === null ? '—' : m.num('units_per_order')!.toFixed(2),
      d: 'on average',
    },
    { k: 'Returned', v: pct(m.num('refund_rate')), d: 'of sales refunded' },
    { k: 'Gross sales', v: money(m.num('gross_sales'), curGs), d: 'before discounts and returns' },
  ];

  return (
    <>
      <div className="mb-4">
        <h1 className="gl-h1">Products</h1>
        <p className="gl-sub mt-1.5">What moved this month — {monthLabel(m.period)}.</p>
      </div>

      <div className="gl-strip" style={{ gridTemplateColumns: 'repeat(4, 1fr)' }}>
        {stats.map((s) => (
          <div className="gl-stat" key={s.k}>
            <div className="gl-k">{s.k}</div>
            <div className="gl-v">{s.v}</div>
            <div className="gl-d">{s.d}</div>
          </div>
        ))}
      </div>

      <p className="gl-note">
        Product-level detail — best and worst sellers, and margin by product — is in your monthly
        report, where cost information can be applied.
      </p>
    </>
  );
}
