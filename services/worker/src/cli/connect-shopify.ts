// Connect a Shopify store to a tenant.
//
//   SHOPIFY_STORE_TOKEN=shpat_... pnpm connect:shopify <tenantId> <shop.myshopify.com>
//
// The token comes from the store's custom app (read scopes only:
// read_orders, read_customers, read_products, read_inventory) and is passed
// via environment so it never lands in shell history.
import { z } from 'zod';
import { closeDbPools } from '@grossline/db';
import { connectShopifyStore } from '../connectors/shopify/connect';

const args = z.tuple([z.string().uuid(), z.string().min(4)]).safeParse(process.argv.slice(2));
const token = process.env.SHOPIFY_STORE_TOKEN;

if (!args.success || !token) {
  console.error(
    'Usage: SHOPIFY_STORE_TOKEN=shpat_... pnpm connect:shopify <tenantId> <shop.myshopify.com>',
  );
  process.exit(1);
}

const [tenantId, shopDomain] = args.data;

connectShopifyStore({ tenantId, shopDomain, accessToken: token })
  .then(async ({ storeId, connectionId }) => {
    console.log(`connected: store ${storeId}, connection ${connectionId}`);
    console.log('next: enqueue a backfill with pnpm worker:sync', tenantId, 'backfill');
    await closeDbPools();
  })
  .catch(async (err) => {
    console.error('connect failed:', err instanceof Error ? err.message : err);
    await closeDbPools();
    process.exit(1);
  });
