import Link from 'next/link';
import { getSettings, type AppSettings } from '@grossline/db';
import { minorUnitExponent } from '@grossline/core';
import { requireSession } from '../../../../lib/auth';
import { PageHeader, Panel, Table, Td, Th } from '../../../../components/ui';
import { FormNotice, SubmitButton } from '../../../../components/forms';
import { savePlans } from '../actions';

export const dynamic = 'force-dynamic';

const cell = 'rounded border border-hairline bg-panel px-2 py-1 text-[13px] text-ink outline-none focus:border-slate';

function feeDecimal(minor: number, currency: string): string {
  const exp = minorUnitExponent(currency);
  return (minor / 10 ** exp).toFixed(exp);
}

export default async function PlansPage({
  searchParams,
}: {
  searchParams: Promise<{ saved?: string; error?: string }>;
}) {
  await requireSession();
  const { saved, error } = await searchParams;
  let settings: AppSettings = { plans: [], thresholds: { costCompleteness: 1, onboardingStaleDays: 3 }, alerts: { emailOnNewTicket: true, emailOnBlockingIssue: false } };
  try {
    settings = await getSettings();
  } catch {
    // fall through to defaults; the notice will show if a save then fails
  }

  // Render existing plans plus three blank rows to add more.
  const rows = [
    ...settings.plans.map((p) => ({ plan: p.plan, fee: feeDecimal(p.monthlyFeeMinor, p.currency), currency: p.currency })),
    ...Array.from({ length: 3 }, () => ({ plan: '', fee: '', currency: 'USD' })),
  ];

  return (
    <>
      <PageHeader
        title="Plan prices"
        sub={
          <span className="flex items-center gap-2">
            The plans you sell. A blank row is ignored.
            <Link href="/settings" className="text-slate hover:text-ink">
              ← settings
            </Link>
          </span>
        }
      />
      <FormNotice saved={saved} error={error} />
      <form action={savePlans}>
        <Panel>
          <Table>
            <thead>
              <tr>
                <Th>plan</Th>
                <Th num>monthly fee</Th>
                <Th>currency</Th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r, i) => (
                <tr key={i} className="group">
                  <Td>
                    <input name="plan" defaultValue={r.plan} placeholder="starter" className={`${cell} w-full`} />
                  </Td>
                  <Td num>
                    <input name="fee" defaultValue={r.fee} inputMode="decimal" placeholder="499.00" className={`${cell} w-28 text-right`} />
                  </Td>
                  <Td>
                    <input name="currency" defaultValue={r.currency} maxLength={3} className={`${cell} w-20`} />
                  </Td>
                </tr>
              ))}
            </tbody>
          </Table>
        </Panel>
        <div className="mt-4">
          <SubmitButton>Save plans</SubmitButton>
        </div>
      </form>
    </>
  );
}
