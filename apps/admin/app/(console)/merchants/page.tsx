import Link from 'next/link';
import { requireSession } from '../../../lib/auth';
import { filterMerchants, loadMerchantRows, type MerchantRow } from '../../../lib/merchants';
import { formatDate, formatMinor } from '../../../lib/format';
import {
  Absent,
  Badge,
  EmptyState,
  ErrorState,
  HealthDot,
  PageHeader,
  Panel,
  Table,
  Td,
  Th,
  Tr,
} from '../../../components/ui';

export const dynamic = 'force-dynamic';

const filterInput =
  'rounded border border-hairline bg-panel px-2 py-1 text-[13px] text-ink outline-none focus:border-slate';

function HealthCell({ row }: { row: MerchantRow }) {
  switch (row.health.kind) {
    case 'none':
      return <Absent reason="no connections" />;
    case 'demo':
      return <Badge>demo</Badge>;
    case 'health':
      return <HealthDot health={row.health.health} />;
  }
}

export default async function MerchantsPage({
  searchParams,
}: {
  searchParams: Promise<{ q?: string; plan?: string; status?: string }>;
}) {
  await requireSession();
  const query = await searchParams;

  let rows: MerchantRow[] | null = null;
  let loadError = false;
  try {
    rows = await loadMerchantRows();
  } catch {
    loadError = true;
  }

  if (loadError || !rows) {
    return (
      <>
        <PageHeader title="Merchants" />
        <ErrorState>Could not load merchants. Is the database up? Check DATABASE_URL.</ErrorState>
      </>
    );
  }

  const plans = [...new Set(rows.map((r) => r.tenant.plan ?? 'none'))].sort();
  const filtered = filterMerchants(rows, query);
  const filtering = Boolean(query.q || query.plan || query.status);

  return (
    <>
      <PageHeader
        title="Merchants"
        sub={
          <span className="flex items-center gap-3">
            Every merchant, live and demo.
            <Link href="/merchants/new" className="text-ink underline">
              New merchant
            </Link>
          </span>
        }
      />

      <form method="get" className="mb-3 flex flex-wrap items-center gap-2">
        <input
          type="search"
          name="q"
          defaultValue={query.q ?? ''}
          placeholder="search name or slug"
          className={filterInput}
        />
        <select name="plan" defaultValue={query.plan ?? ''} className={filterInput}>
          <option value="">any plan</option>
          {plans.map((p) => (
            <option key={p} value={p}>
              {p}
            </option>
          ))}
        </select>
        <select name="status" defaultValue={query.status ?? ''} className={filterInput}>
          <option value="">any status</option>
          {['onboarding', 'active', 'paused', 'churned'].map((s) => (
            <option key={s} value={s}>
              {s}
            </option>
          ))}
        </select>
        <button type="submit" className="rounded border border-hairline px-2.5 py-1 text-[13px] hover:bg-hover">
          Filter
        </button>
        {filtering ? (
          <Link href="/merchants" className="text-[13px] text-slate hover:text-ink">
            clear
          </Link>
        ) : null}
      </form>

      {rows.length === 0 ? (
        <EmptyState>
          No merchants yet.{' '}
          <Link href="/merchants/new" className="text-ink underline">
            Create the first one.
          </Link>
        </EmptyState>
      ) : filtered.length === 0 ? (
        <EmptyState>No merchants match that filter.</EmptyState>
      ) : (
        <Panel>
          <Table>
            <thead>
              <tr>
                <Th>name</Th>
                <Th num>stores</Th>
                <Th>joined</Th>
                <Th>plan</Th>
                <Th num>monthly fee</Th>
                <Th num>ad spend last month</Th>
                <Th num>billed to date</Th>
                <Th>health</Th>
                <Th>status</Th>
              </tr>
            </thead>
            <tbody>
              {filtered.map((row) => (
                <Tr key={row.tenant.id}>
                  <Td>
                    <Link href={`/merchants/${row.tenant.id}`} className="hover:underline">
                      {row.tenant.name}
                    </Link>{' '}
                    {row.tenant.isDemo ? <Badge>demo</Badge> : null}
                  </Td>
                  <Td num>{row.storeCount}</Td>
                  <Td quiet>{formatDate(row.tenant.createdAt)}</Td>
                  <Td quiet>{row.tenant.plan ?? <Absent reason="no plan" />}</Td>
                  <Td num>
                    {formatMinor(row.tenant.monthlyFeeMinor, row.tenant.feeCurrency) ?? (
                      <Absent reason="not set" />
                    )}
                  </Td>
                  <Td num>
                    {row.adSpendLastMonth ? (
                      formatMinor(row.adSpendLastMonth.minor, row.adSpendLastMonth.currency)
                    ) : (
                      <Absent reason="not computed" />
                    )}
                  </Td>
                  <Td num>
                    <Absent reason="no invoices yet" />
                  </Td>
                  <Td>
                    <HealthCell row={row} />
                  </Td>
                  <Td quiet>{row.tenant.status}</Td>
                </Tr>
              ))}
            </tbody>
          </Table>
        </Panel>
      )}
    </>
  );
}
