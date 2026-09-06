import { notFound } from 'next/navigation';
import { getTenant } from '@grossline/db';
import { requireSession } from '../../../../../lib/auth';
import { FormNotice, SubmitButton, TextAreaField } from '../../../../../components/forms';
import { saveNotes } from './actions';

export const dynamic = 'force-dynamic';

export default async function MerchantNotesPage({
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
      <p className="mb-4 max-w-xl text-slate">
        Free-text working notes about this merchant — context, quirks, agreements. Not shown
        anywhere else.
      </p>
      <FormNotice saved={saved} error={error} />
      <form action={saveNotes} className="flex max-w-xl flex-col gap-4">
        <input type="hidden" name="tenantId" value={tenant.id} />
        <TextAreaField label="Notes" name="notes" defaultValue={tenant.notes ?? ''} rows={14} />
        <div>
          <SubmitButton>Save notes</SubmitButton>
        </div>
      </form>
    </>
  );
}
