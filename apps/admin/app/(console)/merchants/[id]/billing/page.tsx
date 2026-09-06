// Plan, fee and partner-rate terms for one merchant. Invoices, payments and
// billed-to-date arrive with task 3.6 — until then those figures stay absent.
import { notFound } from 'next/navigation';
import { getTenant } from '@grossline/db';
import { requireSession } from '../../../../../lib/auth';
import { minorUnitExponent } from '@grossline/core';
import { Absent, SectionHeader } from '../../../../../components/ui';
import { Field, FormNotice, SelectField, SubmitButton } from '../../../../../components/forms';
import { saveBilling } from './actions';

export const dynamic = 'force-dynamic';

function feeAsDecimal(minor: number | null, currency: string): string {
  if (minor === null) return '';
  const exp = minorUnitExponent(currency);
  return (minor / 10 ** exp).toFixed(exp);
}

export default async function MerchantBillingPage({
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

  return (
    <>
      <div className="mb-4 flex flex-wrap gap-x-9 gap-y-3">
        <div>
          <div className="text-[21px] font-semibold tracking-tight">
            <Absent reason="no invoices yet" />
          </div>
          <div className="text-[12px] text-slate">billed to date</div>
        </div>
        <div>
          <div className="text-[21px] font-semibold tracking-tight">
            <Absent reason="no payments yet" />
          </div>
          <div className="text-[12px] text-slate">collected to date</div>
        </div>
      </div>

      <SectionHeader title="Terms" />
      <FormNotice saved={saved} error={error} />
      <form action={saveBilling} className="grid max-w-xl grid-cols-1 gap-4 sm:grid-cols-2">
        <input type="hidden" name="tenantId" value={tenant.id} />
        <Field label="Plan" name="plan" defaultValue={tenant.plan ?? ''} placeholder="starter" />
        <SelectField
          label="Status"
          name="status"
          defaultValue={tenant.status}
          options={['onboarding', 'active', 'paused', 'churned'].map((s) => ({
            value: s,
            label: s,
          }))}
        />
        <Field
          label="Monthly fee"
          name="monthlyFee"
          inputMode="decimal"
          defaultValue={feeAsDecimal(tenant.monthlyFeeMinor, tenant.feeCurrency)}
          hint="leave empty rather than 0 if unpriced — it feeds MRR"
        />
        <Field
          label="Fee currency"
          name="feeCurrency"
          maxLength={3}
          defaultValue={tenant.feeCurrency}
          required
        />
        <Field
          label="Partner rate until"
          name="partnerRateUntil"
          type="date"
          defaultValue={tenant.partnerRateUntil ?? ''}
          hint="design-partner pricing expiry, if any"
        />
        <div className="flex items-end">
          <SubmitButton>Save terms</SubmitButton>
        </div>
      </form>
    </>
  );
}
