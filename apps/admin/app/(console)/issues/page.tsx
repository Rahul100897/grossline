// Every problem across every merchant, in one place (docs/phase-3.md task
// 3.4). Issues are derived, never authored; loadIssuesPage also reconciles the
// transition log so this load records anything that opened or resolved, and
// reads back the 90-day resolved history.
import Link from 'next/link';
import { requireSession } from '../../../lib/auth';
import {
  filterIssues,
  issueCounts,
  loadIssuesPage,
  type Issue,
  type ResolvedIssue,
} from '../../../lib/issues';
import { ageDays, formatDate } from '../../../lib/format';
import {
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

const filterInput =
  'rounded border border-hairline bg-panel px-2 py-1 text-[13px] text-ink outline-none focus:border-slate';

const ISSUE_TYPES = [
  'connection',
  'sync',
  'cost-data',
  'backfill',
  'reconciliation',
  'onboarding',
  'billing',
];

export default async function IssuesPage({
  searchParams,
}: {
  searchParams: Promise<{ q?: string; severity?: string; type?: string }>;
}) {
  await requireSession();
  const query = await searchParams;

  let open: Issue[] | null = null;
  let resolved: (ResolvedIssue & { tenant: string })[] = [];
  let loadError = false;
  try {
    ({ open, resolved } = await loadIssuesPage());
  } catch {
    loadError = true;
  }

  if (loadError || !open) {
    return (
      <>
        <PageHeader title="Issues" />
        <ErrorState>Could not load issues. Is the database up? Check DATABASE_URL.</ErrorState>
      </>
    );
  }

  const counts = issueCounts(open);
  const filtered = filterIssues(open, query);
  const filtering = Boolean(query.q || query.severity || query.type);

  return (
    <>
      <PageHeader
        title="Issues"
        sub={
          counts.total === 0
            ? 'Everything the console knows about, derived live.'
            : `${counts.total} open${counts.blocking > 0 ? `, ${counts.blocking} blocking` : ''} — derived live, ranked by cost to you today.`
        }
      />

      <form method="get" className="mb-3 flex flex-wrap items-center gap-2">
        <input
          type="search"
          name="q"
          defaultValue={query.q ?? ''}
          placeholder="search merchant or text"
          className={filterInput}
        />
        <select name="severity" defaultValue={query.severity ?? ''} className={filterInput}>
          <option value="">any severity</option>
          <option value="blocking">blocking</option>
          <option value="attention">attention</option>
        </select>
        <select name="type" defaultValue={query.type ?? ''} className={filterInput}>
          <option value="">any type</option>
          {ISSUE_TYPES.map((t) => (
            <option key={t} value={t}>
              {t}
            </option>
          ))}
        </select>
        <button type="submit" className="rounded border border-hairline px-2.5 py-1 text-[13px] hover:bg-hover">
          Filter
        </button>
        {filtering ? (
          <Link href="/issues" className="text-[13px] text-slate hover:text-ink">
            clear
          </Link>
        ) : null}
      </form>

      {open.length === 0 ? (
        <EmptyState>Nothing open. Every connection is healthy and every backfill is complete.</EmptyState>
      ) : filtered.length === 0 ? (
        <EmptyState>No open issues match that filter.</EmptyState>
      ) : (
        <Panel>
          <Table>
            <thead>
              <tr>
                <Th>severity</Th>
                <Th>type</Th>
                <Th>merchant</Th>
                <Th>issue</Th>
                <Th>what to do</Th>
                <Th num>age</Th>
              </tr>
            </thead>
            <tbody>
              {filtered.map((issue) => (
                <Tr key={issue.id}>
                  <Td>
                    <Badge tone={issue.severity === 'blocking' ? 'attn' : 'neutral'}>
                      {issue.severity}
                    </Badge>
                  </Td>
                  <Td quiet>{issue.type}</Td>
                  <Td>
                    <Link href={`/merchants/${issue.tenantId}`} className="hover:underline">
                      {issue.tenant}
                    </Link>
                  </Td>
                  <Td>{issue.summary}</Td>
                  <Td quiet>
                    <span className="block max-w-[380px] truncate" title={issue.action}>
                      {issue.action}
                    </span>
                  </Td>
                  <Td num quiet>
                    {ageDays(issue.since)}
                  </Td>
                </Tr>
              ))}
            </tbody>
          </Table>
        </Panel>
      )}

      <SectionHeader
        title="Recently resolved"
        right={<span className="text-[12px] text-slate">last 90 days</span>}
      />
      {resolved.length === 0 ? (
        <EmptyState>Nothing has resolved in the last 90 days.</EmptyState>
      ) : (
        <Panel>
          <Table>
            <thead>
              <tr>
                <Th>type</Th>
                <Th>merchant</Th>
                <Th>issue</Th>
                <Th>resolved</Th>
              </tr>
            </thead>
            <tbody>
              {resolved.map((row) => (
                <Tr key={`${row.tenantId}|${row.issueKey}|${row.resolvedAt.getTime()}`}>
                  <Td quiet>{row.type}</Td>
                  <Td>
                    <Link href={`/merchants/${row.tenantId}`} className="hover:underline">
                      {row.tenant}
                    </Link>
                  </Td>
                  <Td quiet>{row.summary}</Td>
                  <Td quiet>{formatDate(row.resolvedAt)}</Td>
                </Tr>
              ))}
            </tbody>
          </Table>
        </Panel>
      )}
    </>
  );
}
