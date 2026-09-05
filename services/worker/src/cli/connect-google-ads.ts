// Connect a Google Ads client account to a tenant.
//
//   GOOGLE_ADS_REFRESH_TOKEN=1//... pnpm connect:google <tenantId> <customerId> [loginCustomerId]
//
// loginCustomerId defaults to GOOGLE_ADS_LOGIN_CUSTOMER_ID from the environment
// (the MCC). Dashes in ids are fine — they are stripped.
import { z } from 'zod';
import { closeDbPools } from '@grossline/db';
import { connectGoogleAdsAccount } from '../connectors/google-ads/connect';

const args = z
  .tuple([z.string().uuid(), z.string().min(3)])
  .rest(z.string())
  .safeParse(process.argv.slice(2));
const refreshToken = process.env.GOOGLE_ADS_REFRESH_TOKEN;

if (!args.success || !refreshToken) {
  console.error(
    'Usage: GOOGLE_ADS_REFRESH_TOKEN=1//... pnpm connect:google <tenantId> <customerId> [loginCustomerId]',
  );
  process.exit(1);
}

const [tenantId, customerId, loginArg] = args.data;
const loginCustomerId = loginArg ?? process.env.GOOGLE_ADS_LOGIN_CUSTOMER_ID;

if (!loginCustomerId) {
  console.error('Set GOOGLE_ADS_LOGIN_CUSTOMER_ID or pass the MCC id as the third argument.');
  process.exit(1);
}

connectGoogleAdsAccount({ tenantId, customerId, loginCustomerId, refreshToken })
  .then(async ({ connectionId, linked }) => {
    console.log(`connected: connection ${connectionId}${linked ? '' : ' (NOT LINKED — see below)'}`);
    if (!linked) {
      console.log(
        'The client account is not linked to the MCC. Send a link request from the MCC',
        '(Accounts → + → Link existing account), accept it in the client account, then re-run a sync.',
      );
    } else {
      console.log('next: enqueue a backfill with pnpm worker:sync', tenantId, 'backfill');
    }
    await closeDbPools();
  })
  .catch(async (err) => {
    console.error('connect failed:', err instanceof Error ? err.message : err);
    await closeDbPools();
    process.exit(1);
  });
