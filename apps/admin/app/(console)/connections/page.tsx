import { PROVIDER_STREAMS, type Provider } from '@grossline/core';
import {
  getBackfillProgress,
  listConnections,
  listTenants,
  type BackfillProgress,
  type Connection,
  type Tenant,
} from '@grossline/db';
import { requireSession } from '../../../lib/auth';
import { formatDate } from '../../../lib/format';
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

type Row = { tenant: Tenant; connection: Connection; progress: BackfillProgress };

async function loadRows(): Promise<Row[]> {
  const tenants = await listTenants();
  const rows: Row[] = [];
  for (const tenant of tenants) {
    const connections = await listConnections(tenant.id);
    for (const connection of connections) {
      const streams = PROVIDER_STREAMS[connection.provider as Provider] ?? [];
      const progress = await getBackfillProgress(tenant.id, connection.id, streams);
      rows.push({ tenant, connection, progress });
    }
  }
  return rows;
}

const isDemoConnection = (connection: Connection): boolean =>
  ((connection.settings ?? {}) as Record<string, unknown>).demo === true;

function BackfillCell({ connection, progress }: { connection: Connection; progress: BackfillProgress }) {
  if (isDemoConnection(connection)) {
    // Seeded data bypasses sync cursors — a progress figure would be fiction.
    return <span className="text-[12px] text-slate">seeded</span>;
  }
  const pct = Math.round(progress.overall * 100);
  const complete = connection.backfillCompletedAt !== null;
  if (!progress.windowStart && !complete) return <Absent reason="not started" />;
  return (
    <span className="inline-flex items-center gap-2">
      <span className="h-1.5 w-20 overflow-hidden rounded bg-hairline">
        <span
          className={`block h-full ${complete ? 'bg-good' : 'bg-slate'}`}
          style={{ width: `${complete ? 100 : pct}%` }}
        />
      </span>
      <span className="text-[12px] text-slate">{complete ? 'complete' : `${pct}% (partial)`}</span>
    </span>
  );
}

export default async function ConnectionsPage() {
  await requireSession();

  let rows: Row[] | null = null;
  let loadError = false;
  try {
    rows = await loadRows();
  } catch {
    loadError = true;
  }

  return (
    <>
      <PageHeader title="Connections" sub="Every platform connection, every tenant." />
      {loadError ? (
        <ErrorState>Could not load connections. Is the database up? Check DATABASE_URL.</ErrorState>
      ) : rows && rows.length === 0 ? (
        <EmptyState>
          No connections yet. Connect a platform with <code>pnpm connect:shopify</code>,{' '}
          <code>pnpm connect:meta</code> or <code>pnpm connect:google</code>.
        </EmptyState>
      ) : (
        <Panel>
          <Table>
            <thead>
              <tr>
                <Th>tenant</Th>
                <Th>provider</Th>
                <Th>account</Th>
                <Th>health</Th>
                <Th>backfill</Th>
                <Th>last success</Th>
                <Th>last error</Th>
              </tr>
            </thead>
            <tbody>
              {rows!.map(({ tenant, connection, progress }) => (
                <Tr key={connection.id}>
                  <Td>{tenant.name}</Td>
                  <Td quiet>{connection.provider}</Td>
                  <Td quiet>{connection.externalAccountId}</Td>
                  <Td>
                    {isDemoConnection(connection) ? (
                      <Badge>demo</Badge>
                    ) : (
                      <HealthDot health={connection.health} />
                    )}
                  </Td>
                  <Td>
                    <BackfillCell connection={connection} progress={progress} />
                  </Td>
                  <Td quiet>
                    {connection.lastSuccessAt ? (
                      formatDate(connection.lastSuccessAt)
                    ) : (
                      <Absent reason="never" />
                    )}
                  </Td>
                  <Td quiet>
                    {connection.lastError ? (
                      <span
                        className="inline-block max-w-[360px] truncate align-bottom"
                        title={connection.lastError}
                      >
                        {connection.lastError}
                      </span>
                    ) : (
                      <Absent reason="none" />
                    )}
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
