// Seed/refresh unit costs from Shopify's inventoryItem.unitCost (raw
// products): pnpm costs:import-shopify <tenantId>
//
// First sighting of a variant applies from the beginning of time; a changed
// cost gets a new row effective today — historical months never move.
import { z } from 'zod';
import { closeDbPools, importShopifyCosts } from '@grossline/db';

const args = z.tuple([z.string().uuid()]).safeParse(process.argv.slice(2));
if (!args.success) {
  console.error('Usage: pnpm costs:import-shopify <tenantId>');
  process.exit(1);
}

importShopifyCosts(args.data[0])
  .then(async ({ inserted, unchanged }) => {
    console.log(`imported ${inserted} cost row(s); ${unchanged} unchanged`);
    await closeDbPools();
  })
  .catch(async (err) => {
    console.error('costs:import-shopify failed:', err instanceof Error ? err.message : err);
    await closeDbPools();
    process.exit(1);
  });
