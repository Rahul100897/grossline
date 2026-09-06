import { PROVIDER_STREAMS, type Provider } from '@grossline/core';
import {
  getBackfillProgress,
  listConnections,
  type BackfillProgress,
  type Connection,
} from '@grossline/db';
import { requireSession } from '../../../../../lib/auth';
import { formatDate } from '../../../../../lib/format';
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
} from '../../../../../components/ui';
import { Field, FormNotice, SelectField, SubmitButton } from '../../../../../components/forms';
import { connectStore } from './actions';

export const dynamic = 'force-dynamic';

const isDemoConnection = (c: Connection): boolean =>
  ((c.settings ?? {}) as Record<string, unknown>).demo === true;

export default async function MerchantConnectionsPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ saved?: string; error?: string; warning?: string; installUrl?: string }>;
}) {
  await requireSession();
  const { id } = await params;
  const { saved, error, warning, installUrl } = await searchParams;

  let rows: { connection: Connection; progress: BackfillProgress }[] | null = null;
  let loadError = false;
  try {
    const connections = await listConnections(id);
    rows = [];
    for (const connection of connections) {
      const streams = PROVIDER_STREAMS[connection.provider as Provider] ?? [];
      rows.push({
        connection,
        progress: await getBackfillProgress(id, connection.id, streams),
      });
    }
  } catch {
    loadError = true;
  }

  return (
    <>
      {loadError || !rows ? (
        <ErrorState>Could not load connections. Is the database up?</ErrorState>
      ) : rows.length === 0 ? (
        <EmptyState>No connections yet. Connect the first store below.</EmptyState>
      ) : (
        <Panel>
          <Table>
            <thead>
              <tr>
                <Th>provider</Th>
                <Th>account</Th>
                <Th>health</Th>
                <Th>backfill</Th>
                <Th>last success</Th>
                <Th>last error</Th>
              </tr>
            </thead>
            <tbody>
              {rows.map(({ connection, progress }) => (
                <Tr key={connection.id}>
                  <Td quiet>{connection.provider}</Td>
                  <Td>{connection.externalAccountId}</Td>
                  <Td>
                    {isDemoConnection(connection) ? (
                      <Badge>demo</Badge>
                    ) : (
                      <HealthDot health={connection.health} />
                    )}
                  </Td>
                  <Td quiet>
                    {isDemoConnection(connection) ? (
                      'seeded'
                    ) : connection.backfillCompletedAt ? (
                      'complete'
                    ) : progress.windowStart ? (
                      `${Math.round(progress.overall * 100)}% (partial)`
                    ) : (
                      <Absent reason="not started" />
                    )}
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

      <SectionHeader title="Connect a store" />
      <FormNotice saved={saved} error={error} />
      {saved && warning ? (
        <p className="mb-3 rounded border border-attn-line bg-attn-soft px-3 py-2 text-[13px] text-attn">
          Connected with a warning: {decodeURIComponent(warning)}
        </p>
      ) : null}
      {installUrl ? (
        <p className="mb-3 rounded border border-hairline bg-panel px-3 py-2 text-[13px]">
          Send this install link to the store owner (valid about an hour):{' '}
          <a
            href={decodeURIComponent(installUrl)}
            className="break-all text-ink underline"
            target="_blank"
            rel="noreferrer"
          >
            {decodeURIComponent(installUrl)}
          </a>
        </p>
      ) : null}
      <form action={connectStore} className="grid max-w-xl grid-cols-1 gap-4 sm:grid-cols-2">
        <input type="hidden" name="tenantId" value={id} />
        <Field
          label="Shop domain"
          name="shopDomain"
          required
          placeholder="acme-skincare.myshopify.com"
        />
        <SelectField
          label="Auth strategy"
          name="strategy"
          defaultValue="client_credentials"
          options={[
            { value: 'client_credentials', label: 'client_credentials — our own org (Dev Dashboard app)' },
            { value: 'legacy_static', label: 'legacy_static — existing custom-app token' },
            { value: 'authorization_code', label: 'authorization_code — merchant store (install link)' },
          ]}
        />
        <Field
          label="Access token"
          name="accessToken"
          type="password"
          hint="legacy_static only; blank falls back to SHOPIFY_STORE_TOKEN in env"
        />
        <Field
          label="Client id"
          name="clientId"
          hint="blank falls back to SHOPIFY_CLIENT_ID in env"
        />
        <Field
          label="Client secret"
          name="clientSecret"
          type="password"
          hint="blank falls back to SHOPIFY_CLIENT_SECRET in env"
        />
        <div className="flex items-end">
          <SubmitButton>Connect store</SubmitButton>
        </div>
      </form>
      <p className="mt-3 max-w-xl text-[12px] text-slate">
        Meta and Google Ads still connect from the CLI (<code>pnpm connect:meta</code>,{' '}
        <code>pnpm connect:google</code>) — their credentials are org-level, not per-store. After
        connecting, run the backfill: <code>pnpm worker:sync {id} backfill</code>.
      </p>
    </>
  );
}
