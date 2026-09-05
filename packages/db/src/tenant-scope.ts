import { sql } from 'drizzle-orm';
import { z } from 'zod';
import { appDb } from './client';

const tenantIdSchema = z.string().uuid();

type AppDb = ReturnType<typeof appDb>;
/** A drizzle transaction bound to one tenant's RLS context. */
export type ScopedDb = Parameters<Parameters<AppDb['transaction']>[0]>[0];

/**
 * Run `fn` inside a transaction whose connection carries the tenant's RLS
 * context (`app.tenant_id`, transaction-local). Every read and write inside
 * sees exactly that tenant's rows — enforced by Postgres, not by convention.
 *
 * This is the only way application code touches tenant data.
 */
export async function withTenant<T>(
  tenantId: string,
  fn: (tx: ScopedDb) => Promise<T>,
): Promise<T> {
  const id = tenantIdSchema.parse(tenantId);
  return appDb().transaction(async (tx) => {
    await tx.execute(sql`SELECT set_config('app.tenant_id', ${id}, true)`);
    return fn(tx);
  });
}
