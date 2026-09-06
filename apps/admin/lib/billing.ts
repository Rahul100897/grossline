// Billing helpers for the console (docs/phase-3.md task 3.6): quarter maths for
// invoice period lines, and cross-tenant collected/renewal rollups the billing
// overview needs. Money stays integer minor units throughout.
import { listAllPayments, listTenants, type PaymentListRow, type Tenant } from '@grossline/db';

export type Quarter = { label: string; year: number; q: number };

export function currentQuarter(now: Date = new Date()): Quarter {
  const q = Math.floor(now.getUTCMonth() / 3) + 1;
  return { label: `${now.getUTCFullYear()}-Q${q}`, year: now.getUTCFullYear(), q };
}

/** Recent quarters for a picker, newest first. */
export function recentQuarters(now: Date = new Date(), count = 6): Quarter[] {
  const out: Quarter[] = [];
  const cur = currentQuarter(now);
  let year = cur.year;
  let q = cur.q;
  for (let i = 0; i < count; i += 1) {
    out.push({ label: `${year}-Q${q}`, year, q });
    q -= 1;
    if (q === 0) {
      q = 4;
      year -= 1;
    }
  }
  return out;
}

/** The three months of a quarter as {periodStart, periodEnd, label} lines. */
export function quarterMonths(year: number, q: number): {
  periodStart: string;
  periodEnd: string;
  label: string;
}[] {
  const firstMonth = (q - 1) * 3; // 0-based
  return [0, 1, 2].map((offset) => {
    const month = firstMonth + offset;
    const start = new Date(Date.UTC(year, month, 1));
    const end = new Date(Date.UTC(year, month + 1, 0)); // last day of month
    const label = start.toLocaleDateString('en-US', { month: 'long', year: 'numeric', timeZone: 'UTC' });
    return {
      periodStart: start.toISOString().slice(0, 10),
      periodEnd: end.toISOString().slice(0, 10),
      label,
    };
  });
}

export function quarterRange(year: number, q: number): { start: string; end: string } {
  const firstMonth = (q - 1) * 3;
  const start = new Date(Date.UTC(year, firstMonth, 1)).toISOString().slice(0, 10);
  const end = new Date(Date.UTC(year, firstMonth + 3, 0)).toISOString().slice(0, 10);
  return { start, end };
}

export type CollectedTotals = {
  grossByCurrency: Map<string, number>;
  netInrMinor: number;
  xflowFeeByCurrency: Map<string, number>;
  count: number;
};

/** Sum payments received within [start, end] (inclusive), by currency. */
export function sumPayments(payments: PaymentListRow[], start: string, end: string): CollectedTotals {
  const grossByCurrency = new Map<string, number>();
  const xflowFeeByCurrency = new Map<string, number>();
  let netInrMinor = 0;
  let count = 0;
  for (const p of payments) {
    if (p.receivedOn < start || p.receivedOn > end) continue;
    count += 1;
    grossByCurrency.set(p.grossCurrency, (grossByCurrency.get(p.grossCurrency) ?? 0) + p.grossMinor);
    if (p.xflowFeeMinor !== null) {
      xflowFeeByCurrency.set(
        p.grossCurrency,
        (xflowFeeByCurrency.get(p.grossCurrency) ?? 0) + p.xflowFeeMinor,
      );
    }
    if (p.netInrMinor !== null) netInrMinor += p.netInrMinor;
  }
  return { grossByCurrency, netInrMinor, xflowFeeByCurrency, count };
}

export type Renewal = {
  tenant: Tenant;
  kind: 'partner-rate-expiry';
  date: string;
  daysAway: number;
};

/** Design-partner rates expiring within `days` (default 90), soonest first. */
export async function upcomingRenewals(now: Date = new Date(), days = 90): Promise<Renewal[]> {
  const tenants = await listTenants();
  const horizon = new Date(now.getTime() + days * 86_400_000);
  const today = now.toISOString().slice(0, 10);
  const out: Renewal[] = [];
  for (const tenant of tenants) {
    if (!tenant.partnerRateUntil) continue;
    if (tenant.partnerRateUntil < today) continue;
    if (tenant.partnerRateUntil > horizon.toISOString().slice(0, 10)) continue;
    const daysAway = Math.round(
      (new Date(`${tenant.partnerRateUntil}T00:00:00Z`).getTime() - now.getTime()) / 86_400_000,
    );
    out.push({ tenant, kind: 'partner-rate-expiry', date: tenant.partnerRateUntil, daysAway });
  }
  return out.sort((a, b) => a.date.localeCompare(b.date));
}

export { listAllPayments };
