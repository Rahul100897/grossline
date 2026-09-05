import Link from 'next/link';
import { PROVIDER_STREAMS, type Provider } from '@grossline/core';
import {
  getBackfillProgress,
  listConnections,
  listTenants,
  type BackfillProgress,
  type Connection,
  type Tenant,
} from '@grossline/db';
import { requireSession } from '../../lib/auth';

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

const HEALTH_STYLES: Record<string, string> = {
  healthy: 'bg-emerald-100 text-emerald-800',
  degraded: 'bg-amber-100 text-amber-800',
  broken: 'bg-red-100 text-red-800',
};

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
    <main className="mx-auto max-w-5xl p-8">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-semibold">Connections</h1>
        <Link href="/" className="text-sm text-neutral-500 hover:text-neutral-900">
          ← Tenants
        </Link>
      </div>

      {loadError ? (
        <p className="mt-6 rounded border border-red-200 bg-red-50 p-4 text-sm text-red-700">
          Could not load connections. Is the database up? Check DATABASE_URL and try again.
        </p>
      ) : rows && rows.length === 0 ? (
        <p className="mt-6 rounded border border-neutral-200 bg-white p-4 text-sm text-neutral-500">
          No connections yet. Connect a platform with <code className="mx-1">pnpm connect:shopify</code>,
          <code className="mx-1">pnpm connect:meta</code> or <code className="mx-1">pnpm connect:google</code>.
        </p>
      ) : (
        <table className="mt-6 w-full border-collapse text-sm">
          <thead>
            <tr className="border-b border-neutral-300 text-left text-neutral-500">
              <th className="py-2 pr-4 font-medium">Tenant</th>
              <th className="py-2 pr-4 font-medium">Provider</th>
              <th className="py-2 pr-4 font-medium">Account</th>
              <th className="py-2 pr-4 font-medium">Health</th>
              <th className="py-2 pr-4 font-medium">Backfill</th>
              <th className="py-2 pr-4 font-medium">Last success</th>
              <th className="py-2 font-medium">Last error</th>
            </tr>
          </thead>
          <tbody>
            {rows!.map(({ tenant, connection, progress }) => {
              const pct = Math.round(progress.overall * 100);
              const complete = connection.backfillCompletedAt !== null;
              return (
                <tr key={connection.id} className="border-b border-neutral-100 align-top">
                  <td className="py-2 pr-4">{tenant.name}</td>
                  <td className="py-2 pr-4">{connection.provider}</td>
                  <td className="py-2 pr-4 font-mono text-xs">{connection.externalAccountId}</td>
                  <td className="py-2 pr-4">
                    <span
                      className={`rounded px-1.5 py-0.5 text-xs ${HEALTH_STYLES[connection.health] ?? ''}`}
                    >
                      {connection.health}
                    </span>
                  </td>
                  <td className="py-2 pr-4">
                    <div className="flex items-center gap-2">
                      <div className="h-2 w-24 overflow-hidden rounded bg-neutral-200">
                        <div
                          className={`h-full ${complete ? 'bg-emerald-500' : 'bg-blue-500'}`}
                          style={{ width: `${pct}%` }}
                        />
                      </div>
                      <span className="text-xs text-neutral-600">
                        {complete ? 'complete' : progress.windowStart ? `${pct}% (partial)` : 'not started'}
                      </span>
                    </div>
                  </td>
                  <td className="py-2 pr-4 text-xs text-neutral-600">
                    {connection.lastSuccessAt
                      ? connection.lastSuccessAt.toISOString().replace('T', ' ').slice(0, 16)
                      : '—'}
                  </td>
                  <td className="max-w-56 py-2 text-xs text-red-700">
                    {connection.lastError ?? '—'}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      )}
    </main>
  );
}
