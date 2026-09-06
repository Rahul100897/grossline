// Metrics explorer (docs/phase-3.md task 3.5): pick a tenant and a month, read
// every metric with MoM/YoY comparison, drill from the monthly summary to the
// daily series and the campaign/platform breakdown. Display rules enforced:
// absent stays absent; completeness shown wherever margin appears; provisional
// flags on cohort metrics; platform-reported figures visually distinct and
// never placed to be summed with blended ones; cost provenance visible.
import Link from 'next/link';
import {
  listMetricDailySeries,
  listMetricPeriods,
  listMetricValuesForPeriod,
  listTenants,
  type MetricValueRow,
} from '@grossline/db';
import { requireSession } from '../../../lib/auth';
import { loadExplorer, type ExplorerData, type SummaryRow } from '../../../lib/metrics-explorer';
import { formatDelta, formatMetric } from '../../../lib/metric-format';
import { formatMinor } from '../../../lib/format';
import {
  Absent,
  Badge,
  EmptyState,
  ErrorState,
  PageHeader,
  Panel,
  SectionHeader,
  Table,
  Td,
  Th,
  Tr,
} from '../../../components/ui';

export const dynamic = 'force-dynamic';

const pickerInput =
  'rounded border border-hairline bg-panel px-2 py-1 text-[13px] text-ink outline-none focus:border-slate';

function isPlatformReported(meta: Record<string, unknown>): boolean {
  return meta.referenceOnly === true || meta.neverBlended === true || meta.platformReported === true;
}

function Flags({ row }: { row: SummaryRow }) {
  const meta = row.meta;
  const completeness = typeof meta.completeness === 'number' ? meta.completeness : null;
  return (
    <span className="inline-flex flex-wrap gap-1">
      {meta.provisional === true ? <Badge tone="attn">provisional</Badge> : null}
      {completeness !== null && completeness < 1 ? (
        <Badge tone="attn">{Math.round(completeness * 100)}% of lines costed</Badge>
      ) : null}
      {row.metric === 'full_contribution_margin_missing_inputs' ? (
        <Badge tone="attn">missing inputs</Badge>
      ) : null}
    </span>
  );
}

function DeltaCell({ delta, row }: { delta: number | null; row: SummaryRow }) {
  const d = formatDelta(delta, row.metric, row.currency);
  if (d === null) return <Absent reason="no base" />;
  if (delta === 0) return <span className="text-slate">·</span>;
  return <span className={d.negative ? 'text-attn' : 'text-good'}>{d.text}</span>;
}

function SummaryTable({
  group,
  tenant,
  period,
  activeMetric,
}: {
  group: { title: string; rows: SummaryRow[] };
  tenant: string;
  period: string;
  activeMetric?: string;
}) {
  return (
    <>
      <SectionHeader title={group.title} />
      <Panel>
        <Table>
          <thead>
            <tr>
              <Th>metric</Th>
              <Th num>value</Th>
              <Th num>vs prev month</Th>
              <Th num>vs year ago</Th>
              <Th>flags</Th>
            </tr>
          </thead>
          <tbody>
            {group.rows.map((row) => {
              const value = formatMetric(row.value, row.metric, row.currency);
              const href = `/metrics?tenant=${tenant}&period=${period}&metric=${row.metric}`;
              return (
                <Tr key={row.metric}>
                  <Td>
                    <Link
                      href={href}
                      className={`hover:underline ${row.metric === activeMetric ? 'font-medium' : ''}`}
                    >
                      {row.metric}
                    </Link>
                  </Td>
                  <Td num>{value ?? <Absent reason="not computed" />}</Td>
                  <Td num>
                    <DeltaCell delta={row.momDelta} row={row} />
                  </Td>
                  <Td num>
                    <DeltaCell delta={row.yoyDelta} row={row} />
                  </Td>
                  <Td>
                    <Flags row={row} />
                  </Td>
                </Tr>
              );
            })}
          </tbody>
        </Table>
      </Panel>
    </>
  );
}

function scopedValue(row: MetricValueRow): string {
  return formatMetric(Number(row.value), row.metric, row.currency) ?? row.value;
}

export default async function MetricsExplorerPage({
  searchParams,
}: {
  searchParams: Promise<{ tenant?: string; period?: string; metric?: string }>;
}) {
  await requireSession();
  const query = await searchParams;

  let tenants: { id: string; name: string }[] = [];
  let loadError = false;
  try {
    tenants = (await listTenants()).map((t) => ({ id: t.id, name: t.name }));
  } catch {
    loadError = true;
  }

  if (loadError) {
    return (
      <>
        <PageHeader title="Metrics" />
        <ErrorState>Could not load tenants. Is the database up?</ErrorState>
      </>
    );
  }
  if (tenants.length === 0) {
    return (
      <>
        <PageHeader title="Metrics" />
        <EmptyState>No tenants yet. Create one before exploring metrics.</EmptyState>
      </>
    );
  }

  const tenantId = query.tenant && tenants.some((t) => t.id === query.tenant) ? query.tenant : tenants[0]!.id;
  const periods = await listMetricPeriods(tenantId, 'month');
  const period = query.period && periods.includes(query.period) ? query.period : (periods[0] ?? null);

  let data: ExplorerData | null = null;
  let daily: MetricValueRow[] = [];
  let breakdown: MetricValueRow[] = [];
  if (period) {
    data = await loadExplorer(tenantId, period);
    if (query.metric) {
      daily = await listMetricDailySeries(tenantId, { metric: query.metric, monthPeriod: period });
      breakdown = (await listMetricValuesForPeriod(tenantId, 'month', period)).filter(
        (r) => r.metric === query.metric && r.scope !== '',
      );
    }
  }

  return (
    <>
      <PageHeader title="Metrics" sub="Pick a merchant and a month. Drill a metric to its daily series and campaigns." />

      <form method="get" className="mb-4 flex flex-wrap items-center gap-2">
        <select name="tenant" defaultValue={tenantId} className={pickerInput}>
          {tenants.map((t) => (
            <option key={t.id} value={t.id}>
              {t.name}
            </option>
          ))}
        </select>
        <select name="period" defaultValue={period ?? ''} className={pickerInput}>
          {periods.length === 0 ? (
            <option value="">no months</option>
          ) : (
            periods.map((p) => (
              <option key={p} value={p}>
                {p.slice(0, 7)}
              </option>
            ))
          )}
        </select>
        <button type="submit" className="rounded border border-hairline px-2.5 py-1 text-[13px] hover:bg-hover">
          Show
        </button>
      </form>

      {!period || !data ? (
        <EmptyState>
          No metrics computed for this merchant yet. Run{' '}
          <code>pnpm --filter @grossline/worker metrics:compute {tenantId} &lt;YYYY-MM&gt;</code> after a
          sync.
        </EmptyState>
      ) : (
        <>
          {query.metric ? (
            <>
              <SectionHeader
                title={`Drill — ${query.metric}, ${period.slice(0, 7)}`}
                right={
                  <Link
                    href={`/metrics?tenant=${tenantId}&period=${period}`}
                    className="text-[12px] text-slate hover:text-ink"
                  >
                    close drill
                  </Link>
                }
              />
              {breakdown.length > 0 ? (
                <div className="mb-3">
                  {breakdown.some((r) => isPlatformReported((r.meta ?? {}) as Record<string, unknown>)) ? (
                    <p className="mb-2 text-[12px] text-attn">
                      Platform-reported figures — each platform&apos;s own claim. Not blended, and not
                      additive across platforms.
                    </p>
                  ) : null}
                  <Panel>
                    <Table>
                      <thead>
                        <tr>
                          <Th>scope</Th>
                          <Th num>value</Th>
                          <Th>flags</Th>
                        </tr>
                      </thead>
                      <tbody>
                        {breakdown.map((r) => {
                          const meta = (r.meta ?? {}) as Record<string, unknown>;
                          return (
                            <Tr key={r.scope}>
                              <Td quiet>{r.scope}</Td>
                              <Td num>{scopedValue(r)}</Td>
                              <Td>
                                {isPlatformReported(meta) ? <Badge>platform-reported</Badge> : null}
                              </Td>
                            </Tr>
                          );
                        })}
                      </tbody>
                    </Table>
                  </Panel>
                </div>
              ) : null}
              {daily.length > 0 ? (
                <Panel>
                  <Table>
                    <thead>
                      <tr>
                        <Th>day</Th>
                        <Th num>{query.metric}</Th>
                      </tr>
                    </thead>
                    <tbody>
                      {daily.map((r) => (
                        <Tr key={r.period}>
                          <Td quiet>{r.period}</Td>
                          <Td num>{scopedValue(r)}</Td>
                        </Tr>
                      ))}
                    </tbody>
                  </Table>
                </Panel>
              ) : (
                <EmptyState>No daily series stored for {query.metric}.</EmptyState>
              )}
            </>
          ) : null}

          {data.coverage ? (
            <>
              <SectionHeader title="Cost coverage & provenance" />
              <Panel>
                <Table>
                  <tbody>
                    <Tr>
                      <Td quiet>lines costed</Td>
                      <Td>
                        {data.coverage.costedLines}/{data.coverage.totalLines} (
                        {Math.round(data.coverage.coverageRate * 100)}%)
                      </Td>
                    </Tr>
                    <Tr>
                      <Td quiet>revenue at stake</Td>
                      <Td>
                        {formatMinor(data.coverage.revenueAtStakeMinor, data.coverage.currency)} of{' '}
                        {formatMinor(data.coverage.totalRevenueMinor, data.coverage.currency)}
                      </Td>
                    </Tr>
                    <Tr>
                      <Td quiet>from merchant upload</Td>
                      <Td>{data.coverage.provenance.uploadLines} lines</Td>
                    </Tr>
                    <Tr>
                      <Td quiet>Shopify, real date</Td>
                      <Td>{data.coverage.provenance.shopifyDatedLines} lines</Td>
                    </Tr>
                    <Tr>
                      <Td quiet>Shopify, epoch-assumed</Td>
                      <Td>
                        {data.coverage.provenance.shopifyEpochAssumedLines > 0 ? (
                          <span className="text-attn">
                            {data.coverage.provenance.shopifyEpochAssumedLines} lines — cost applied to
                            all history without a real effective date
                          </span>
                        ) : (
                          '0 lines'
                        )}
                      </Td>
                    </Tr>
                  </tbody>
                </Table>
              </Panel>
            </>
          ) : null}

          {data.groups.map((group) => (
            <SummaryTable
              key={group.title}
              group={group}
              tenant={tenantId}
              period={period}
              activeMetric={query.metric}
            />
          ))}
        </>
      )}
    </>
  );
}
