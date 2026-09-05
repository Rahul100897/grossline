// Demo tenants have no *external* connections — but raw ad tables hang off a
// connection row and the console lists connections per provider. This mints
// one credential-less internal connection per platform, flagged demo in
// settings, purely as an anchor: it never syncs, and the console renders it
// as "seeded" rather than showing sync health or backfill progress it does
// not have.
import { createConnection, listConnections, updateConnectionSettings } from './connections';

export async function ensureDemoConnection(
  tenantId: string,
  provider: 'shopify' | 'meta' | 'google_ads',
  externalAccountId: string,
  storeId?: string,
): Promise<string> {
  const existing = (await listConnections(tenantId)).find(
    (c) => c.provider === provider && c.externalAccountId === externalAccountId,
  );
  if (existing) {
    const settings = (existing.settings ?? {}) as Record<string, unknown>;
    if (settings.demo !== true) {
      await updateConnectionSettings(tenantId, existing.id, {
        settings: { ...settings, demo: true },
      });
    }
    return existing.id;
  }
  const connection = await createConnection({
    tenantId,
    provider,
    externalAccountId,
    storeId,
    accountTimezone: 'America/New_York',
    accountCurrency: 'USD',
    settings: { demo: true },
  });
  return connection.id;
}
