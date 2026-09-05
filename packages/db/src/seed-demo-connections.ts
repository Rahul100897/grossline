// Demo tenants have no *external* connections — but raw ad tables hang off a
// connection row. This mints one credential-less internal connection per
// platform, flagged demo in settings, purely as a foreign-key anchor.
import { createConnection, listConnections } from './connections';

export async function ensureDemoConnection(
  tenantId: string,
  provider: 'meta' | 'google_ads',
  externalAccountId: string,
): Promise<string> {
  const existing = (await listConnections(tenantId)).find(
    (c) => c.provider === provider && c.externalAccountId === externalAccountId,
  );
  if (existing) return existing.id;
  const connection = await createConnection({
    tenantId,
    provider,
    externalAccountId,
    accountTimezone: 'America/New_York',
    accountCurrency: 'USD',
    settings: { demo: true },
  });
  return connection.id;
}
