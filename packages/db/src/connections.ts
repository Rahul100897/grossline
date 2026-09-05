import { eq } from 'drizzle-orm';
import { z } from 'zod';
import { connections } from './schema';
import { withTenant } from './tenant-scope';

export type Connection = typeof connections.$inferSelect;

const createConnectionSchema = z.object({
  tenantId: z.string().uuid(),
  storeId: z.string().uuid().optional(),
  provider: z.enum(['shopify', 'google_ads', 'meta']),
  externalAccountId: z.string().min(1),
  credentialRef: z.string().uuid().optional(),
  accountTimezone: z.string().optional(),
  accountCurrency: z.string().optional(),
  settings: z.record(z.string(), z.unknown()).optional(),
});

export type CreateConnectionInput = z.input<typeof createConnectionSchema>;

export async function createConnection(input: CreateConnectionInput): Promise<Connection> {
  const data = createConnectionSchema.parse(input);
  const [row] = await withTenant(data.tenantId, (tx) =>
    tx.insert(connections).values(data).returning(),
  );
  if (!row) throw new Error('connection insert returned no row');
  return row;
}

export async function listConnections(tenantId: string): Promise<Connection[]> {
  return withTenant(tenantId, (tx) => tx.select().from(connections));
}

export async function getConnection(
  tenantId: string,
  connectionId: string,
): Promise<Connection | null> {
  const [row] = await withTenant(tenantId, (tx) =>
    tx.select().from(connections).where(eq(connections.id, connectionId)).limit(1),
  );
  return row ?? null;
}

export async function updateConnectionHealth(
  tenantId: string,
  connectionId: string,
  patch: {
    health: 'healthy' | 'degraded' | 'broken';
    lastError?: string | null;
    lastSuccessAt?: Date;
  },
): Promise<void> {
  await withTenant(tenantId, (tx) =>
    tx
      .update(connections)
      .set({
        health: patch.health,
        lastError: patch.lastError ?? null,
        ...(patch.lastSuccessAt ? { lastSuccessAt: patch.lastSuccessAt } : {}),
      })
      .where(eq(connections.id, connectionId)),
  );
}

export async function markBackfillComplete(
  tenantId: string,
  connectionId: string,
): Promise<void> {
  await withTenant(tenantId, (tx) =>
    tx
      .update(connections)
      .set({ backfillCompletedAt: new Date() })
      .where(eq(connections.id, connectionId)),
  );
}

export async function updateConnectionSettings(
  tenantId: string,
  connectionId: string,
  patch: {
    accountTimezone?: string;
    accountCurrency?: string;
    settings?: Record<string, unknown>;
  },
): Promise<void> {
  await withTenant(tenantId, (tx) =>
    tx.update(connections).set(patch).where(eq(connections.id, connectionId)),
  );
}
