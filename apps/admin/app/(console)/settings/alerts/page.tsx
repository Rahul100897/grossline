import Link from 'next/link';
import { getSettings } from '@grossline/db';
import { requireSession } from '../../../../lib/auth';
import { PageHeader } from '../../../../components/ui';
import { FormNotice, SubmitButton } from '../../../../components/forms';
import { saveAlerts } from '../actions';

export const dynamic = 'force-dynamic';

export default async function AlertsPage({
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
        title="Alerts"
        sub={
          <span className="flex items-center gap-2">
            What you get emailed about (needs RESEND_API_KEY set).
            <Link href="/settings" className="text-slate hover:text-ink">
              ← settings
            </Link>
          </span>
        }
      />
      <FormNotice saved={saved} error={error} />
      <form action={saveAlerts} className="flex max-w-xl flex-col gap-3">
        <label className="flex items-center gap-2 text-[13px]">
          <input type="checkbox" name="emailOnNewTicket" defaultChecked={settings.alerts.emailOnNewTicket} />
          Email me when a support ticket arrives
        </label>
        <label className="flex items-center gap-2 text-[13px]">
          <input type="checkbox" name="emailOnBlockingIssue" defaultChecked={settings.alerts.emailOnBlockingIssue} />
          Email me when a blocking issue appears
        </label>
        <div>
          <SubmitButton>Save alerts</SubmitButton>
        </div>
      </form>
    </>
  );
}
