import Link from 'next/link';
import { requireSession } from '../../../lib/auth';
import { PageHeader, Panel } from '../../../components/ui';

export const dynamic = 'force-dynamic';

const SECTIONS: { href: string; title: string; blurb: string }[] = [
  { href: '/settings/definitions', title: 'Metric definitions', blurb: 'Rendered from docs/metrics.md — the single source of truth.' },
  { href: '/settings/plans', title: 'Plan prices', blurb: 'The plans you sell and their monthly fees.' },
  { href: '/settings/thresholds', title: 'Thresholds', blurb: 'When cost gaps and stalled onboarding become issues.' },
  { href: '/settings/alerts', title: 'Alerts', blurb: 'What you get emailed about.' },
  { href: '/settings/business', title: 'Business & invoicing', blurb: 'Your details on every invoice PDF.' },
  { href: '/settings/account', title: 'Admin account', blurb: 'Your login.' },
];

export default async function SettingsPage() {
  await requireSession();
  return (
    <>
      <PageHeader title="Settings" />
      <div className="grid gap-3 sm:grid-cols-2">
        {SECTIONS.map((s) => (
          <Link key={s.href} href={s.href} className="block">
            <Panel>
              <div className="p-3">
                <div className="text-[13px] font-semibold">{s.title}</div>
                <div className="mt-1 text-[12px] text-slate">{s.blurb}</div>
              </div>
            </Panel>
          </Link>
        ))}
      </div>
    </>
  );
}
