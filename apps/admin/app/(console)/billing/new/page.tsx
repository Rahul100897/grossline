// New invoice (task 3.6). Pick a merchant and a quarter; the three months are
// pre-filled as period lines at the merchant's monthly fee, each editable.
// Leaving a line's amount blank drops it, so one or two months bill fine too.
import { notFound } from 'next/navigation';
import { minorUnitExponent } from '@grossline/core';
import { getTenant, listTenants } from '@grossline/db';
import { requireSession } from '../../../../lib/auth';
import { currentQuarter, quarterMonths, recentQuarters } from '../../../../lib/billing';
import { PageHeader, Panel, SectionHeader, Table, Td, Th, Tr } from '../../../../components/ui';
import { Field, FormNotice, SubmitButton } from '../../../../components/forms';
import { createInvoiceAction } from './actions';

export const dynamic = 'force-dynamic';

const input =
  'rounded border border-hairline bg-panel px-2 py-1 text-[13px] text-ink outline-none focus:border-slate';

function feeDecimal(minor: number | null, currency: string): string {
  if (minor === null) return '';
  const exp = minorUnitExponent(currency);
  return (minor / 10 ** exp).toFixed(exp);
}

export default async function NewInvoicePage({
  searchParams,
}: {
  searchParams: Promise<{ tenant?: string; quarter?: string; error?: string }>;
}) {
  await requireSession();
  const query = await searchParams;
  const tenants = await listTenants();
  if (tenants.length === 0) notFound();

  const tenantId = query.tenant && tenants.some((t) => t.id === query.tenant) ? query.tenant : tenants[0]!.id;
  const tenant = await getTenant(tenantId);
  if (!tenant) notFound();

  const quarters = recentQuarters();
  const chosen =
    quarters.find((q) => q.label === query.quarter) ?? currentQuarter();
  const months = quarterMonths(chosen.year, chosen.q);
  const currency = tenant.feeCurrency;
  const fee = feeDecimal(tenant.monthlyFeeMinor, currency);

  const today = new Date().toISOString().slice(0, 10);
  // Default due date: 14 days out.
  const due = new Date(Date.now() + 14 * 86_400_000).toISOString().slice(0, 10);

  return (
    <>
      <PageHeader title="New invoice" sub="Pick a merchant and a quarter; edit the period lines as needed." />
      <FormNotice error={query.error} />

      {/* Merchant + quarter pickers reload the page with fresh defaults. */}
      <form method="get" className="mb-4 flex flex-wrap items-center gap-2">
        <select name="tenant" defaultValue={tenantId} className={input}>
          {tenants.map((t) => (
            <option key={t.id} value={t.id}>
              {t.name}
            </option>
          ))}
        </select>
        <select name="quarter" defaultValue={chosen.label} className={input}>
          {quarters.map((q) => (
            <option key={q.label} value={q.label}>
              {q.label}
            </option>
          ))}
        </select>
        <button type="submit" className="rounded border border-hairline px-2.5 py-1 text-[13px] hover:bg-hover">
          Reset lines
        </button>
      </form>

      <form action={createInvoiceAction}>
        <input type="hidden" name="tenantId" value={tenant.id} />
        <div className="mb-4 grid max-w-xl grid-cols-1 gap-4 sm:grid-cols-3">
          <Field label="Currency" name="currency" defaultValue={currency} maxLength={3} required />
          <Field label="Issued on" name="issuedOn" type="date" defaultValue={today} required />
          <Field label="Due on" name="dueOn" type="date" defaultValue={due} required />
        </div>

        <SectionHeader title={`Period lines — ${chosen.label}`} />
        <Panel>
          <Table>
            <thead>
              <tr>
                <Th>description</Th>
                <Th>period start</Th>
                <Th>period end</Th>
                <Th num>amount ({currency})</Th>
              </tr>
            </thead>
            <tbody>
              {months.map((m, i) => (
                <Tr key={m.periodStart}>
                  <Td>
                    <input
                      name={`line_${i}_description`}
                      defaultValue={`Analytics & reporting — ${m.label}`}
                      className={`${input} w-full min-w-[220px]`}
                    />
                  </Td>
                  <Td>
                    <input name={`line_${i}_periodStart`} type="date" defaultValue={m.periodStart} className={input} />
                  </Td>
                  <Td>
                    <input name={`line_${i}_periodEnd`} type="date" defaultValue={m.periodEnd} className={input} />
                  </Td>
                  <Td num>
                    <input
                      name={`line_${i}_amount`}
                      inputMode="decimal"
                      defaultValue={fee}
                      placeholder="blank = skip"
                      className={`${input} w-28 text-right`}
                    />
                  </Td>
                </Tr>
              ))}
            </tbody>
          </Table>
        </Panel>
        {tenant.monthlyFeeMinor === null ? (
          <p className="mt-2 text-[12px] text-attn">
            This merchant has no monthly fee set — the line amounts are blank. Set a fee on the
            merchant&apos;s Billing tab, or type amounts here.
          </p>
        ) : null}

        <div className="mt-4 max-w-xl">
          <label className="flex flex-col gap-1">
            <span className="text-[12px] text-slate">Notes (optional)</span>
            <textarea name="notes" rows={3} className={`${input} w-full`} />
          </label>
        </div>

        <div className="mt-4">
          <SubmitButton>Create invoice</SubmitButton>
        </div>
      </form>
    </>
  );
}
