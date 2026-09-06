import Link from 'next/link';
import { notFound } from 'next/navigation';
import { minorUnitExponent } from '@grossline/core';
import { getTenant, listTenantCostInputs, type TenantCostInputs } from '@grossline/db';
import { requireSession } from '../../../../../lib/auth';
import { saveCostInputs } from './actions';

export const dynamic = 'force-dynamic';

const money = (minor: number | null, currency: string): string => {
  if (minor === null) return '—';
  const exp = minorUnitExponent(currency);
  return `${(minor / 10 ** exp).toFixed(exp)} ${currency}`;
};
const percent = (bp: number | null): string => (bp === null ? '—' : `${(bp / 100).toFixed(2)}%`);

function Field({ label, name, placeholder }: { label: string; name: string; placeholder?: string }) {
  return (
    <label className="flex flex-col gap-1 text-sm">
      {label}
      <input
        name={name}
        inputMode="decimal"
        placeholder={placeholder ?? '—'}
        className="rounded border border-neutral-300 px-3 py-2"
      />
    </label>
  );
}

export default async function CostInputsPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ saved?: string; error?: string }>;
}) {
  await requireSession();
  const { id } = await params;
  const { saved, error } = await searchParams;
  const tenant = await getTenant(id);
  if (!tenant) notFound();

  const history = (await listTenantCostInputs(id)).slice().reverse(); // newest first
  const today = new Date().toISOString().slice(0, 10);

  return (
    <main className="mx-auto max-w-3xl p-8">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-semibold">Cost inputs — {tenant.name}</h1>
        <Link href="/" className="text-sm text-neutral-500 hover:text-neutral-900">
          ← Tenants
        </Link>
      </div>
      <p className="mt-1 text-sm text-neutral-500">
        Merchant-supplied costs and targets. Every save is a snapshot from its effective date —
        historical months never change.
      </p>

      {saved ? (
        <p className="mt-4 rounded border border-emerald-200 bg-emerald-50 p-3 text-sm text-emerald-800">
          Saved.
        </p>
      ) : null}
      {error ? (
        <p className="mt-4 rounded border border-red-200 bg-red-50 p-3 text-sm text-red-700">
          Could not save — check the values (decimals like 2.9 or 4.50; dates as YYYY-MM-DD).
        </p>
      ) : null}

      <form action={saveCostInputs} className="mt-6 grid grid-cols-2 gap-4">
        <input type="hidden" name="tenantId" value={tenant.id} />
        <label className="flex flex-col gap-1 text-sm">
          Effective from
          <input
            name="effectiveFrom"
            type="date"
            defaultValue={today}
            required
            className="rounded border border-neutral-300 px-3 py-2"
          />
        </label>
        <label className="flex flex-col gap-1 text-sm">
          Currency
          <input
            name="currency"
            defaultValue={tenant.reportingCurrency}
            maxLength={3}
            required
            className="rounded border border-neutral-300 px-3 py-2 uppercase"
          />
        </label>
        <Field label="Payment fee %" name="paymentFeePercent" placeholder="2.9" />
        <Field label="Payment fee fixed (per order)" name="paymentFeeFixed" placeholder="0.30" />
        <Field label="Shipping cost (per order)" name="shippingCost" placeholder="6.50" />
        <Field label="Fulfilment cost (per order)" name="fulfilmentCost" placeholder="2.80" />
        <Field label="Packaging cost (per order)" name="packagingCost" placeholder="0.90" />
        <Field label="Monthly revenue target" name="monthlyRevenueTarget" placeholder="120000" />
        <Field label="Monthly ad spend target" name="monthlySpendTarget" placeholder="25000" />
        <div className="col-span-2">
          <button
            type="submit"
            className="rounded bg-neutral-900 px-4 py-2 text-white hover:bg-neutral-700"
          >
            Save snapshot
          </button>
        </div>
      </form>

      <h2 className="mt-10 text-lg font-medium">History</h2>
      {history.length === 0 ? (
        <p className="mt-3 rounded border border-neutral-200 bg-white p-4 text-sm text-neutral-500">
          No cost inputs yet. The first snapshot above becomes the baseline.
        </p>
      ) : (
        <div className="mt-3 overflow-x-auto">
          <table className="w-full border-collapse text-sm">
            <thead>
              <tr className="border-b border-neutral-300 text-left text-neutral-500">
                <th className="py-2 pr-4 font-medium">Effective from</th>
                <th className="py-2 pr-4 font-medium">Payment fee</th>
                <th className="py-2 pr-4 font-medium">Shipping</th>
                <th className="py-2 pr-4 font-medium">Fulfilment</th>
                <th className="py-2 pr-4 font-medium">Packaging</th>
                <th className="py-2 pr-4 font-medium">Revenue target</th>
                <th className="py-2 font-medium">Spend target</th>
              </tr>
            </thead>
            <tbody>
              {history.map((row: TenantCostInputs) => (
                <tr key={row.id} className="border-b border-neutral-100">
                  <td className="py-2 pr-4 font-mono text-xs">{row.effectiveFrom}</td>
                  <td className="py-2 pr-4">
                    {percent(row.paymentFeeBp)}
                    {row.paymentFeeFixedMinor !== null
                      ? ` + ${money(row.paymentFeeFixedMinor, row.currency)}`
                      : ''}
                  </td>
                  <td className="py-2 pr-4">{money(row.shippingCostPerOrderMinor, row.currency)}</td>
                  <td className="py-2 pr-4">{money(row.fulfilmentCostPerOrderMinor, row.currency)}</td>
                  <td className="py-2 pr-4">{money(row.packagingCostPerOrderMinor, row.currency)}</td>
                  <td className="py-2 pr-4">{money(row.monthlyRevenueTargetMinor, row.currency)}</td>
                  <td className="py-2">{money(row.monthlySpendTargetMinor, row.currency)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </main>
  );
}
