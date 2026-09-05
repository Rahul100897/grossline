import { z } from 'zod';
import { stores } from './schema';
import { withTenant } from './tenant-scope';

export type Store = typeof stores.$inferSelect;

const createStoreSchema = z.object({
  tenantId: z.string().uuid(),
  shopDomain: z.string().min(1),
  storeCurrency: z.string().length(3),
  storeTimezone: z.string().min(1),
});

export type CreateStoreInput = z.input<typeof createStoreSchema>;

export async function createStore(input: CreateStoreInput): Promise<Store> {
  const data = createStoreSchema.parse(input);
  const [row] = await withTenant(data.tenantId, (tx) =>
    tx
      .insert(stores)
      .values(data)
      .onConflictDoUpdate({
        target: [stores.tenantId, stores.shopDomain],
        set: { storeCurrency: data.storeCurrency, storeTimezone: data.storeTimezone },
      })
      .returning(),
  );
  if (!row) throw new Error('store insert returned no row');
  return row;
}

export async function listStores(tenantId: string): Promise<Store[]> {
  return withTenant(tenantId, (tx) => tx.select().from(stores));
}
