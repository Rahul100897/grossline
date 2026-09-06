import Link from 'next/link';
import { getBusinessProfile } from '@grossline/db';
import { requireSession } from '../../../../lib/auth';
import { PageHeader } from '../../../../components/ui';
import { Field, FormNotice, SubmitButton, TextAreaField } from '../../../../components/forms';
import { saveBusiness } from '../actions';

export const dynamic = 'force-dynamic';

export default async function BusinessSettingsPage({
  searchParams,
}: {
  searchParams: Promise<{ saved?: string; error?: string }>;
}) {
  await requireSession();
  const { saved, error } = await searchParams;
  const profile = await getBusinessProfile();

  return (
    <>
      <PageHeader
        title="Business & invoicing"
        sub={
          <span className="flex items-center gap-2">
            These details appear on every invoice PDF.
            <Link href="/settings" className="text-slate hover:text-ink">
              ← settings
            </Link>
          </span>
        }
      />
      <FormNotice saved={saved} error={error} />
      <form action={saveBusiness} className="grid max-w-2xl grid-cols-1 gap-4 sm:grid-cols-2">
        <Field label="Legal name" name="legalName" defaultValue={profile?.legalName ?? ''} required />
        <Field label="Invoice email" name="invoiceEmail" defaultValue={profile?.invoiceEmail ?? ''} />
        <Field label="GSTIN" name="gstin" defaultValue={profile?.gstin ?? ''} hint="optional" />
        <Field
          label="Export LUT number"
          name="lutNumber"
          defaultValue={profile?.lutNumber ?? ''}
          hint="zero-rated export of services; shown on invoices"
        />
        <div className="sm:col-span-2">
          <TextAreaField label="Address" name="addressLines" defaultValue={profile?.addressLines ?? ''} rows={3} />
        </div>
        <div className="sm:col-span-2">
          <TextAreaField label="Bank / remittance details" name="bankDetails" defaultValue={profile?.bankDetails ?? ''} rows={3} />
        </div>
        <div className="sm:col-span-2">
          <TextAreaField label="Invoice footer" name="footer" defaultValue={profile?.footer ?? ''} rows={2} />
        </div>
        <div className="sm:col-span-2">
          <SubmitButton>Save business details</SubmitButton>
        </div>
      </form>
    </>
  );
}
