import { notFound } from 'next/navigation';
import { getTenant, lastMetricRun, listConnections, type Connection } from '@grossline/db';
import { requireSession } from '../../../../lib/auth';
import { deriveIssues } from '../../../../lib/issues';
import { ageDays, formatDate, formatMinor } from '../../../../lib/format';
import {
  Absent,
  Badge,
  EmptyState,
  ErrorState,
  HealthDot,
  Panel,
  SectionHeader,
  Table,
  Td,
  Th,
  Tr,
} from '../../../../components/ui';

export const dynamic = 'force-dynamic';

const isDemoConnection = (c: Connection): boolean =>
  ((c.settings ?? {}) as Record<string, unknown>).demo === true;

export default async function MerchantOverviewPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  await requireSession();
  const { id } = await params;
  const tenant = await getTenant(id);
  if (!tenant) notFound();

  let connections: Connection[] = [];
  let metricRun: Awaited<ReturnType<typeof lastMetricRun>> = null;
  let issues: Awaited<ReturnType<typeof deriveIssues>> = [];
  let loadError = false;
  try {
    connections = await listConnections(id);
    metricRun = await lastMetricRun(id);
    issues = (await deriveIssues()).filter((i) => i.tenantId === id);
  } catch {
    loadError = true;
  }

  if (loadError) {
    return <ErrorState>Could not load this merchant. Is the database up?</ErrorState>;
  }

  const facts: { label: string; value: React.ReactNode }[] = [
    { label: 'slug', value: tenant.slug },
    { label: 'joined', value: formatDate(tenant.createdAt) },
    { label: 'plan', value: tenant.plan ?? <Absent reason="no plan" /> },
    {
      label: 'monthly fee',
      value: formatMinor(tenant.monthlyFeeMinor, tenant.feeCurrency) ?? <Absent reason="not set" />,
    },
    {
      label: 'partner rate until',
      value: tenant.partnerRateUntil ? formatDate(tenant.partnerRateUntil) : <Absent reason="none" />,
    },
    { label: 'reporting currency', value: tenant.reportingCurrency },
    { label: 'reporting timezone', value: tenant.reportingTimezone },
    {
      label: 'last metric run',
      value: metricRun ? (
        <>
          {metricRun.status}
          {metricRun.finishedAt ? ` · ${formatDate(metricRun.finishedAt)}` : null}
        </>
      ) : (
        <Absent reason="never computed" />
      ),
    },
  ];

  return (
    <>
      <SectionHeader title="Facts" />
      <Panel>
        <Table>
          <tbody>
            {facts.map((f) => (
              <Tr key={f.label}>
                <Td quiet>{f.label}</Td>
                <Td>{f.value}</Td>
              </Tr>
            ))}
          </tbody>
        </Table>
      </Panel>

      <SectionHeader title="Connections" />
      {connections.length === 0 ? (
        <EmptyState>No connections yet. Connect a store from the Connections tab.</EmptyState>
      ) : (
        <Panel>
          <Table>
            <tbody>
              {connections.map((c) => (
                <Tr key={c.id}>
                  <Td quiet>{c.provider}</Td>
                  <Td>{c.externalAccountId}</Td>
                  <Td>{isDemoConnection(c) ? <Badge>demo</Badge> : <HealthDot health={c.health} />}</Td>
                </Tr>
              ))}
            </tbody>
          </Table>
        </Panel>
      )}

      <SectionHeader title="Open issues" />
      {issues.length === 0 ? (
        <EmptyState>Nothing open for this merchant.</EmptyState>
      ) : (
        <Panel>
          <Table>
            <thead>
              <tr>
                <Th>severity</Th>
                <Th>issue</Th>
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
                  <Td>{issue.summary}</Td>
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
