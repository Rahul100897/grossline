import { minorUnitExponent } from '@grossline/core';
import { listMetricPeriods, listMetricValuesForPeriod } from '@grossline/db';
import { requirePortalSession } from '../../lib/session';

export const dynamic = 'force-dynamic';

const MONTHS = [
  'January',
  'February',
  'March',
  'April',
  'May',
  'June',
  'July',
  'August',
  'September',
  'October',
  'November',
  'December',
];

function monthLabel(period: string): string {
  const [y, m] = period.split('-');
  return `${MONTHS[Number(m) - 1]} ${y}`;
}

function money(minor: number, currency: string): string {
  const exp = minorUnitExponent(currency);
  return `${currency} ${(minor / 10 ** exp).toLocaleString('en-US', {
    minimumFractionDigits: exp,
    maximumFractionDigits: exp,
  })}`;
}

export default async function ThisMonthPage() {
  // Tenant comes from the session, never from the URL. Every query below is
  // scoped to it through the tenant-scoped db helpers.
  const session = await requirePortalSession();
  const tenantId = session.activeTenantId;

  const periods = await listMetricPeriods(tenantId, 'month');
  const latest = periods[0] ?? null;
  const rows = latest ? await listMetricValuesForPeriod(tenantId, 'month', latest) : [];
  const byMetric = new Map(rows.filter((r) => r.scope === '').map((r) => [r.metric, r]));

  const val = (metric: string): (typeof rows)[number] | undefined => byMetric.get(metric);
  const num = (metric: string): number | null => {
    const r = val(metric);
    return r ? Number(r.value) : null;
  };

  const netSales = val('net_sales');
  const orders = num('order_count');
  const contribution = val('contribution_after_ad_spend');
  const aov = val('aov');

  return (
    <>
      <div className="mb-4">
        <h1 className="gl-h1">This month</h1>
        <p className="gl-sub mt-1.5">{latest ? monthLabel(latest) : 'No completed month yet.'}</p>
      </div>

      {latest ? (
        <div className="gl-strip n2" style={{ gridTemplateColumns: 'repeat(4, 1fr)' }}>
          <div className="gl-stat">
            <div className="gl-k">What you sold</div>
            <div className="gl-v">
              {netSales ? money(Number(netSales.value), netSales.currency ?? 'USD') : '—'}
            </div>
            <div className="gl-d">net of discounts and returns</div>
          </div>
          <div className="gl-stat">
            <div className="gl-k">Orders</div>
            <div className="gl-v">{orders === null ? '—' : orders.toLocaleString('en-US')}</div>
            <div className="gl-d">this month</div>
          </div>
          <div className="gl-stat">
            <div className="gl-k">What you kept</div>
            <div className="gl-v">
              {contribution
                ? money(Number(contribution.value), contribution.currency ?? 'USD')
                : '—'}
            </div>
            <div className="gl-d">after every cost we can see</div>
          </div>
          <div className="gl-stat">
            <div className="gl-k">Average order</div>
            <div className="gl-v">
              {aov ? money(Number(aov.value), aov.currency ?? 'USD') : '—'}
            </div>
            <div className="gl-d">across the month</div>
          </div>
        </div>
      ) : (
        <div className="gl-empty">
          Your first month of figures will appear here once we have processed a full month of your
          store&rsquo;s data.
        </div>
      )}

      <p className="gl-note">
        These are the headline figures. Your full monthly report — what changed, where the numbers
        disagree, and what is worth changing — arrives as a PDF and in your Reports tab.
      </p>
    </>
  );
}
