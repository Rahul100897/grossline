// Compact per-merchant metric readout: every stored value for one month. The
// full explorer with comparisons and drill-down is task 3.5; this tab is the
// raw truth for one tenant. Display rules still apply: absent stays absent,
// provisional and completeness meta always visible.
import Link from 'next/link';
import {
  getTenant,
  listMetricPeriods,
  listMetricValuesForPeriod,
  type MetricValueRow,
} from '@grossline/db';
import { notFound } from 'next/navigation';
import { requireSession } from '../../../../../lib/auth';
import { formatMinor } from '../../../../../lib/format';
import {
  Badge,
  EmptyState,
  ErrorState,
  Panel,
  SectionHeader,
  Table,
  Td,
  Th,
  Tr,
} from '../../../../../components/ui';

export const dynamic = 'force-dynamic';

function metricValue(row: MetricValueRow): string {
  if (row.currency) return formatMinor(Number(row.value), row.currency) ?? row.value;
  const n = Number(row.value);
  return Number.isInteger(n) ? new Intl.NumberFormat('en-US').format(n) : String(n);
}

function MetaBadges({ row }: { row: MetricValueRow }) {
  const meta = (row.meta ?? {}) as Record<string, unknown>;
  return (
    <span className="inline-flex gap-1">
      {meta.provisional === true ? <Badge tone="attn">provisional</Badge> : null}
      {typeof meta.completeness === 'number' && meta.completeness < 1 ? (
        <Badge tone="attn">{Math.round(meta.completeness * 100)}% of lines costed</Badge>
      ) : null}
      {meta.platformReported === true || meta.referenceOnly === true ? (
        <Badge>platform-reported</Badge>
      ) : null}
    </span>
  );
}

export default async function MerchantMetricsPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ period?: string }>;
}) {
  await requireSession();
  const { id } = await params;
  const query = await searchParams;
  const tenant = await getTenant(id);
  if (!tenant) notFound();

  let months: string[] = [];
  let rows: MetricValueRow[] = [];
  let loadError = false;
  let period: string | null = null;
  try {
    months = await listMetricPeriods(id, 'month');
    period = query.period && months.includes(query.period) ? query.period : (months[0] ?? null);
    if (period) rows = await listMetricValuesForPeriod(id, 'month', period);
  } catch {
    loadError = true;
  }

  if (loadError) {
    return <ErrorState>Could not load metric values. Is the database up?</ErrorState>;
  }
  if (months.length === 0 || !period) {
    return (
      <EmptyState>
        No metrics computed yet. Run <code>pnpm --filter @grossline/worker metrics:compute {id}</code>{' '}
        after a sync.
      </EmptyState>
    );
  }

  return (
    <>
      <SectionHeader
        title={`Month of ${period.slice(0, 7)}`}
        right={
          <span className="flex gap-2 text-[12px]">
            {months.slice(0, 12).map((m) => (
              <Link
                key={m}
                href={`/merchants/${id}/metrics?period=${m}`}
                className={m === period ? 'font-medium text-ink' : 'text-slate hover:text-ink'}
              >
                {m.slice(0, 7)}
              </Link>
            ))}
          </span>
        }
      />
      <Panel>
        <Table>
          <thead>
            <tr>
              <Th>metric</Th>
              <Th>scope</Th>
              <Th num>value</Th>
              <Th>flags</Th>
            </tr>
          </thead>
          <tbody>
            {rows.map((row) => (
              <Tr key={`${row.metric}|${row.scope}`}>
                <Td>{row.metric}</Td>
                <Td quiet>{row.scope || ''}</Td>
                <Td num>{metricValue(row)}</Td>
                <Td>
                  <MetaBadges row={row} />
                </Td>
              </Tr>
            ))}
          </tbody>
        </Table>
      </Panel>
    </>
  );
}
