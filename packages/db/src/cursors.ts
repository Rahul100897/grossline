import { and, eq, sql } from 'drizzle-orm';
import { z } from 'zod';
import { syncCursors } from './schema';
import { withTenant } from './tenant-scope';

const idSchema = z.string().uuid();

export async function getCursor<T = unknown>(
  tenantId: string,
  connectionId: string,
  stream: string,
): Promise<T | null> {
  idSchema.parse(connectionId);
  const [row] = await withTenant(tenantId, (tx) =>
    tx
      .select({ cursor: syncCursors.cursor })
      .from(syncCursors)
      .where(and(eq(syncCursors.connectionId, connectionId), eq(syncCursors.stream, stream)))
      .limit(1),
  );
  return (row?.cursor as T) ?? null;
}

export async function setCursor(
  tenantId: string,
  connectionId: string,
  stream: string,
  cursor: unknown,
): Promise<void> {
  idSchema.parse(connectionId);
  await withTenant(tenantId, (tx) =>
    tx
      .insert(syncCursors)
      .values({ tenantId, connectionId, stream, cursor })
      .onConflictDoUpdate({
        target: [syncCursors.tenantId, syncCursors.connectionId, syncCursors.stream],
        set: { cursor, updatedAt: sql`now()` },
      }),
  );
}

export async function clearCursors(tenantId: string, connectionId: string): Promise<void> {
  idSchema.parse(connectionId);
  await withTenant(tenantId, (tx) =>
    tx.delete(syncCursors).where(eq(syncCursors.connectionId, connectionId)),
  );
}
