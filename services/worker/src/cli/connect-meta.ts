// Connect a Meta ad account to a tenant.
//
//   META_ACCOUNT_TOKEN=EAA... pnpm connect:meta <tenantId> <act_1234567890>
//
// Use a long-lived system-user token scoped to ads_read for the account.
import { z } from 'zod';
import { closeDbPools } from '@grossline/db';
import { connectMetaAccount } from '../connectors/meta/connect';

const args = z
  .tuple([z.string().uuid(), z.string().regex(/^act_\d+$/)])
  .safeParse(process.argv.slice(2));
const token = process.env.META_ACCOUNT_TOKEN;

if (!args.success || !token) {
  console.error('Usage: META_ACCOUNT_TOKEN=EAA... pnpm connect:meta <tenantId> <act_1234567890>');
  process.exit(1);
}

const [tenantId, adAccountId] = args.data;

connectMetaAccount({ tenantId, adAccountId, accessToken: token })
  .then(async ({ connectionId }) => {
    console.log(`connected: connection ${connectionId}`);
    console.log('next: enqueue a backfill with pnpm worker:sync', tenantId, 'backfill');
    await closeDbPools();
  })
  .catch(async (err) => {
    console.error('connect failed:', err instanceof Error ? err.message : err);
    await closeDbPools();
    process.exit(1);
  });
