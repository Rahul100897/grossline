import type { ReactNode } from 'react';
import { notFound } from 'next/navigation';
import { getTenant } from '@grossline/db';
import { requireSession } from '../../../../lib/auth';
import { Badge } from '../../../../components/ui';
import { TabNav } from '../../../../components/tabs';

export const dynamic = 'force-dynamic';

export default async function MerchantLayout({
  children,
  params,
}: {
  children: ReactNode;
  params: Promise<{ id: string }>;
}) {
  await requireSession();
  const { id } = await params;
  const tenant = await getTenant(id);
  if (!tenant) notFound();

  const base = `/merchants/${tenant.id}`;
  return (
    <>
      <div className="mb-3 flex items-baseline gap-2">
        <h1 className="text-[15px] font-semibold tracking-tight">{tenant.name}</h1>
        {tenant.isDemo ? <Badge>demo</Badge> : null}
        <span className="text-[12px] text-slate">{tenant.status}</span>
      </div>
      <TabNav
        items={[
          { href: base, label: 'Overview', exact: true },
          { href: `${base}/connections`, label: 'Connections' },
          { href: `${base}/stores`, label: 'Stores' },
          { href: `${base}/metrics`, label: 'Metrics' },
          { href: `${base}/costs`, label: 'Costs' },
          { href: `${base}/billing`, label: 'Billing' },
          { href: `${base}/notes`, label: 'Notes' },
        ]}
      />
      {children}
    </>
  );
}
