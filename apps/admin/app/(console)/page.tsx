// Overview (docs/phase-3.md task 3.2): four numbers and a prioritised list —
// not a stat wall. MRR comes from tenant fee columns; "collected this quarter"
// stays absent until invoices exist (3.6); "reports due" stays absent until
// report generation exists (Phase 5). Absent stays absent — words, never zero.
import { listTenants, type Tenant } from '@grossline/db';
import { requireSession } from '../../lib/auth';
import { deriveIssues, issueCounts, type Issue } from '../../lib/issues';
import { ageDays, formatCount, formatMinor } from '../../lib/format';
import {
  Absent,
  Badge,
  EmptyState,
  ErrorState,
  NumberStrip,
  PageHeader,
  Panel,
  SectionHeader,
  Table,
  Td,
  Th,
  Tr,
} from '../../components/ui';

export const dynamic = 'force-dynamic';

/**
 * Sum monthly fees per currency across active, non-demo tenants. Tenants with
 * no fee set are excluded from the sum and counted so the label can say so —
 * a fee that was never entered must not read as $0 of revenue.
 */
function monthlyRecurring(tenants: Tenant[]): { formatted: string | null; unpriced: number } {
  const byCurrency = new Map<string, number>();
  let unpriced = 0;
  for (const t of tenants) {
    if (t.isDemo || t.status !== 'active') continue;
    if (t.monthlyFeeMinor === null) {
      unpriced += 1;
      continue;
    }
    byCurrency.set(t.feeCurrency, (byCurrency.get(t.feeCurrency) ?? 0) + t.monthlyFeeMinor);
  }
  if (byCurrency.size === 0) return { formatted: null, unpriced };
  const parts = [...byCurrency.entries()].map(([currency, minor]) => formatMinor(minor, currency));
  return { formatted: parts.join(' + '), unpriced };
}

export default async function OverviewPage() {
  await requireSession();

  let tenants: Tenant[] | null = null;
  let issues: Issue[] | null = null;
  let loadError = false;
  try {
    tenants = await listTenants();
    issues = await deriveIssues();
  } catch {
    loadError = true;
  }

  if (loadError || !tenants || !issues) {
    return (
      <>
        <PageHeader title="Overview" />
        <ErrorState>Could not load the overview. Is the database up? Check DATABASE_URL.</ErrorState>
      </>
    );
  }

  const mrr = monthlyRecurring(tenants);
  const counts = issueCounts(issues);

  return (
    <>
      <PageHeader title="Overview" />
      <NumberStrip
        items={[
          {
            label: mrr.unpriced > 0 ? `monthly recurring (${mrr.unpriced} unpriced)` : 'monthly recurring',
            value: mrr.formatted ?? <Absent reason="no fees set yet" />,
          },
          {
            label: 'collected this quarter',
            value: <Absent reason="no invoices yet" />,
          },
          {
            label: counts.blocking > 0 ? `open issues (${counts.blocking} blocking)` : 'open issues',
            value: formatCount(counts.total),
            tone: counts.blocking > 0 ? 'attn' : counts.total > 0 ? 'ink' : 'good',
          },
          {
            label: 'reports due',
            value: <Absent reason="no report schedule yet" />,
          },
        ]}
      />

      <SectionHeader
        title="Needs your attention"
        right={<span className="text-[12px] text-slate">blocking first, then by cost to you today</span>}
      />
      {issues.length === 0 ? (
        <EmptyState>Nothing needs your attention. Every connection is healthy.</EmptyState>
      ) : (
        <Panel>
          <Table>
            <thead>
              <tr>
                <Th>severity</Th>
                <Th>merchant</Th>
                <Th>issue</Th>
                <Th>what to do</Th>
                <Th num>age</Th>
              </tr>
            </thead>
            <tbody>
              {issues.map((issue) => (
                <Tr key={issue.id}>
                  <Td>
                    <Badge tone={issue.severity === 'blocking' ? 'attn' : 'neutral'}>
                      {issue.severity}
                    </Badge>
                  </Td>
                  <Td>{issue.tenant}</Td>
                  <Td>{issue.summary}</Td>
                  <Td quiet>
                    <span className="block max-w-[420px] truncate" title={issue.action}>
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
    </>
  );
}
