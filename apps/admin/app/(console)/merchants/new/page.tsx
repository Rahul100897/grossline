import { requireSession } from '../../../../lib/auth';
import { PageHeader } from '../../../../components/ui';
import { Field, FormNotice, SelectField, SubmitButton } from '../../../../components/forms';
import { createMerchant } from './actions';

export const dynamic = 'force-dynamic';

export default async function NewMerchantPage({
  searchParams,
}: {
  searchParams: Promise<{ error?: string }>;
}) {
  await requireSession();
  const { error } = await searchParams;

  return (
    <>
      <PageHeader
        title="New merchant"
        sub="Reporting currency and timezone are the tenant's own; each store's come from Shopify at connect time."
      />
      <FormNotice error={error} />
      <form action={createMerchant} className="grid max-w-xl grid-cols-1 gap-4 sm:grid-cols-2">
        <Field label="Name" name="name" required placeholder="Acme Skincare" />
        <Field
          label="Slug"
          name="slug"
          required
          placeholder="acme-skincare"
          hint="lowercase kebab-case, permanent"
        />
        <Field
          label="Reporting currency"
          name="reportingCurrency"
          required
          maxLength={3}
          placeholder="USD"
        />
        <Field
          label="Reporting timezone"
          name="reportingTimezone"
          required
          placeholder="America/New_York"
          hint="IANA name; applied at query time, storage stays UTC"
        />
        <SelectField
          label="Status"
          name="status"
          defaultValue="onboarding"
          options={['onboarding', 'active', 'paused', 'churned'].map((s) => ({
            value: s,
            label: s,
          }))}
        />
        <Field label="Plan" name="plan" placeholder="starter" hint="optional" />
        <Field
          label="Monthly fee"
          name="monthlyFee"
          inputMode="decimal"
          placeholder="499.00"
          hint="optional — leave empty rather than 0 if unpriced"
        />
        <Field label="Fee currency" name="feeCurrency" maxLength={3} placeholder="USD" hint="defaults to reporting currency" />
        <div className="sm:col-span-2">
          <SubmitButton>Create merchant</SubmitButton>
        </div>
      </form>
    </>
  );
}
