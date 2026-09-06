// Reconciliation panel (docs/phase-3.md task 3.9): the 1.7 harness in the
// browser. Pick a merchant and a month; run our totals from the raw tables
// against the platform UI figures in the committed expected-values file, and
// read variance, tolerance and the structural explanation where one applies —
// without the terminal.
import { listTenants } from '@grossline/db';
import { expectedFileSchema, reconcile, type ReconciliationReport } from '@grossline/worker/reconcile';
import { requireSession } from '../../../lib/auth';
import { readDoc } from '../../../lib/doc-render';
import { formatDate } from '../../../lib/format';
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
export const runtime = 'nodejs';

const pickerInput =
  'rounded border border-hairline bg-panel px-2 py-1 text-[13px] text-ink outline-none focus:border-slate';

/** Recent YYYY-MM labels for the picker (last 12 months). */
function recentMonths(now = new Date(), count = 12): string[] {
  const out: string[] = [];
  for (let i = 0; i < count; i += 1) {
    const d = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - i, 1));
    out.push(`${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}`);
  }
  return out;
}

function num(n: number | null, digits = 2): string {
  return n === null ? '—' : n.toLocaleString('en-US', { minimumFractionDigits: digits, maximumFractionDigits: digits });
}

function statusBadge(status: ReconciliationReport['rows'][number]['status']) {
  switch (status) {
    case 'within':
      return <Badge tone="good">within</Badge>;
    case 'explained':
      return <Badge tone="good">explained</Badge>;
    case 'outside':
      return <Badge tone="attn">outside</Badge>;
    case 'no-expected':
      return <Badge>no platform figure</Badge>;
  }
}

export default async function ReconciliationPage({
  searchParams,
}: {
  searchParams: Promise<{ tenant?: string; month?: string }>;
}) {
  await requireSession();
  const query = await searchParams;

  let tenants: { id: string; name: string; slug: string }[] = [];
  let loadError = false;
  try {
    tenants = (await listTenants()).map((t) => ({ id: t.id, name: t.name, slug: t.slug }));
  } catch {
    loadError = true;
  }

  if (loadError) {
    return (
      <>
        <PageHeader title="Reconciliation" />
        <ErrorState>Could not load tenants. Is the database up?</ErrorState>
      </>
    );
  }
  if (tenants.length === 0) {
    return (
      <>
        <PageHeader title="Reconciliation" />
        <EmptyState>No tenants yet.</EmptyState>
      </>
    );
  }

  const months = recentMonths();
  const tenant = tenants.find((t) => t.id === query.tenant) ?? tenants[0]!;
  const month = query.month && months.includes(query.month) ? query.month : months[0]!;

  // Run the harness. Load the committed expected-values file for this slug.
  let report: ReconciliationReport | null = null;
  let runError: string | null = null;
  let hadExpectedFile = false;
  try {
    const raw = await readDoc(`docs/reconciliation/expected/${tenant.slug}.json`);
    const expected = raw ? expectedFileSchema.parse(JSON.parse(raw)) : null;
    hadExpectedFile = expected !== null;
    report = await reconcile({ tenantIdOrSlug: tenant.id, month, expected });
  } catch (error) {
    runError = error instanceof Error ? error.message : 'reconciliation failed';
  }

  return (
    <>
      <PageHeader
        title="Reconciliation"
        sub="Our totals from the raw tables against the platform UI figures — variance, tolerance, and the structural reason where one applies."
      />

      <form method="get" className="mb-4 flex flex-wrap items-center gap-2">
        <select name="tenant" defaultValue={tenant.id} className={pickerInput}>
          {tenants.map((t) => (
            <option key={t.id} value={t.id}>
              {t.name}
            </option>
          ))}
        </select>
        <select name="month" defaultValue={month} className={pickerInput}>
          {months.map((m) => (
            <option key={m} value={m}>
              {m}
            </option>
          ))}
        </select>
        <button type="submit" className="rounded border border-hairline px-2.5 py-1 text-[13px] hover:bg-hover">
          Run
        </button>
      </form>

      {runError ? (
        <ErrorState>Could not run reconciliation: {runError}</ErrorState>
      ) : report ? (
        <>
          <div className="mb-3 flex items-center gap-3">
            {report.ok ? (
              <Badge tone="good">every variance within tolerance or explained</Badge>
            ) : (
              <Badge tone="attn">unexplained variance outside tolerance</Badge>
            )}
            <span className="text-[12px] text-slate">
              {tenant.name} · {report.month} · {report.currency}
            </span>
          </div>

          <Panel>
            <Table>
              <thead>
                <tr>
                  <Th>metric</Th>
                  <Th num>ours</Th>
                  <Th num>platform</Th>
                  <Th num>variance</Th>
                  <Th num>variance %</Th>
                  <Th num>tolerance</Th>
                  <Th>status</Th>
                  <Th>explanation</Th>
                </tr>
              </thead>
              <tbody>
                {report.rows.map((row) => (
                  <Tr key={row.metric}>
                    <Td>{row.metric}</Td>
                    <Td num>{num(row.ours)}</Td>
                    <Td num>{row.expected === null ? <Absent reason="not recorded" /> : num(row.expected)}</Td>
                    <Td num>{row.variance === null ? <Absent reason="—" /> : num(row.variance)}</Td>
                    <Td num>{row.variancePct === null ? <Absent reason="—" /> : `${row.variancePct.toFixed(3)}%`}</Td>
                    <Td num quiet>
                      {row.tolerancePct}%
                    </Td>
                    <Td>{statusBadge(row.status)}</Td>
                    <Td quiet>
                      {row.note ? (
                        <span className="block max-w-[320px] whitespace-normal">{row.note}</span>
                      ) : (
                        ''
                      )}
                    </Td>
                  </Tr>
                ))}
              </tbody>
            </Table>
          </Panel>

          {report.structuralNotes.length > 0 ? (
            <>
              <SectionHeader title="Structural notes" />
              <Panel>
                <ul className="list-disc p-3 pl-7 text-[13px]">
                  {report.structuralNotes.map((note, i) => (
                    <li key={i} className="my-1">
                      {note}
                    </li>
                  ))}
                </ul>
              </Panel>
            </>
          ) : null}

          {!hadExpectedFile ? (
            <p className="mt-3 max-w-2xl text-[12px] text-attn">
              No expected-values file for <code>{tenant.slug}</code>. Record the platform UI figures
              in <code>docs/reconciliation/expected/{tenant.slug}.json</code> (see
              docs/reconciliation.md) to compare against a platform figure — for now only our totals
              are shown.
            </p>
          ) : null}
          <p className="mt-2 text-[12px] text-slate">Run at {formatDate(new Date())}.</p>
        </>
      ) : null}
    </>
  );
}
