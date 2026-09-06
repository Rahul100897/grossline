import Link from 'next/link';
import { getSettings } from '@grossline/db';
import { requireSession } from '../../../../lib/auth';
import { PageHeader } from '../../../../components/ui';
import { Field, FormNotice, SubmitButton } from '../../../../components/forms';
import { saveThresholds } from '../actions';

export const dynamic = 'force-dynamic';

export default async function ThresholdsPage({
  searchParams,
}: {
  searchParams: Promise<{ saved?: string; error?: string }>;
}) {
  await requireSession();
  const { saved, error } = await searchParams;
  const settings = await getSettings();

  return (
    <>
      <PageHeader
        title="Thresholds"
        sub={
          <span className="flex items-center gap-2">
            When gaps become issues on the Issues page.
            <Link href="/settings" className="text-slate hover:text-ink">
              ← settings
            </Link>
          </span>
        }
      />
      <FormNotice saved={saved} error={error} />
      <form action={saveThresholds} className="grid max-w-xl grid-cols-1 gap-4 sm:grid-cols-2">
        <Field
          label="Cost completeness floor (%)"
          name="costCompletenessPct"
          inputMode="decimal"
          defaultValue={String(Math.round(settings.thresholds.costCompleteness * 100))}
          hint="below this, a margin is flagged incomplete"
        />
        <Field
          label="Onboarding stale after (days)"
          name="onboardingStaleDays"
          inputMode="decimal"
          defaultValue={String(settings.thresholds.onboardingStaleDays)}
          hint="an unfinished onboarding older than this is flagged"
        />
        <div className="sm:col-span-2">
          <SubmitButton>Save thresholds</SubmitButton>
        </div>
      </form>
    </>
  );
}
