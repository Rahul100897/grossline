// Connect a Shopify store to a tenant. Three auth strategies (see
// docs/decisions.md — Shopify auth changes 2026):
//
// 1) Existing admin-created custom app token (legacy — cannot be newly created):
//    SHOPIFY_STORE_TOKEN=shpat_... pnpm connect:shopify <tenantId> <shop.myshopify.com> legacy_static
//
// 2) Dev Dashboard app + store in OUR OWN Shopify organization:
//    SHOPIFY_CLIENT_ID=... SHOPIFY_CLIENT_SECRET=... \
//      pnpm connect:shopify <tenantId> <shop.myshopify.com> client_credentials
//
// 3) Merchant store (custom distribution) — prints the install URL; the flow
//    completes in the admin app's /api/shopify/callback:
//    SHOPIFY_CLIENT_ID=... pnpm connect:shopify <tenantId> <shop.myshopify.com> authorization_code
//
// Secrets travel via environment so they never land in shell history.
import { z } from 'zod';
import {
  SHOPIFY_OAUTH_SCOPES,
  buildShopifyInstallUrl,
  createSessionToken,
  loadRootEnv,
} from '@grossline/core';
import { closeDbPools } from '@grossline/db';
import { connectShopifyStore } from '../connectors/shopify/connect';
import { shopifyAuthStrategySchema } from '../connectors/shopify/auth';

loadRootEnv();

const args = z
  .tuple([z.string().uuid(), z.string().min(4)])
  .rest(shopifyAuthStrategySchema)
  .safeParse(process.argv.slice(2));

if (!args.success) {
  console.error(
    'Usage: pnpm connect:shopify <tenantId> <shop.myshopify.com> [legacy_static|client_credentials|authorization_code]',
  );
  process.exit(1);
}

const [tenantId, shopDomain, strategy = 'legacy_static'] = args.data;

async function main(): Promise<void> {
  if (strategy === 'authorization_code') {
    const clientId = process.env.SHOPIFY_CLIENT_ID ?? process.env.SHOPIFY_API_KEY;
    const sessionSecret = process.env.SESSION_SECRET;
    if (!clientId || !sessionSecret) {
      throw new Error('authorization_code needs SHOPIFY_CLIENT_ID (or SHOPIFY_API_KEY) and SESSION_SECRET');
    }
    const redirectUri =
      process.env.SHOPIFY_REDIRECT_URI ?? 'http://localhost:3000/api/shopify/callback';
    // The state token carries the tenant, signed, valid for an hour.
    const state = await createSessionToken(
      { sub: tenantId, exp: Date.now() + 60 * 60_000 },
      sessionSecret,
    );
    const url = buildShopifyInstallUrl({
      shopDomain,
      clientId,
      scopes: SHOPIFY_OAUTH_SCOPES,
      redirectUri,
      state,
    });
    console.log('Open this install URL as the store owner (valid ~1 hour):\n');
    console.log(url);
    console.log(
      '\nThe admin app must be running and reachable at the redirect URI',
      `(${redirectUri}) to complete the flow.`,
    );
    return;
  }

  if (strategy === 'legacy_static') {
    const token = process.env.SHOPIFY_STORE_TOKEN;
    if (!token) throw new Error('legacy_static needs SHOPIFY_STORE_TOKEN');
    const result = await connectShopifyStore({
      tenantId,
      shopDomain,
      strategy,
      accessToken: token,
    });
    report(result);
    return;
  }

  const clientId = process.env.SHOPIFY_CLIENT_ID;
  const clientSecret = process.env.SHOPIFY_CLIENT_SECRET;
  if (!clientId || !clientSecret) {
    throw new Error('client_credentials needs SHOPIFY_CLIENT_ID and SHOPIFY_CLIENT_SECRET');
  }
  const result = await connectShopifyStore({
    tenantId,
    shopDomain,
    strategy,
    clientId,
    clientSecret,
  });
  report(result);
}

function report(result: { storeId: string; connectionId: string; scopeWarning: string | null }) {
  console.log(`connected: store ${result.storeId}, connection ${result.connectionId}`);
  if (result.scopeWarning) {
    console.warn(`\nWARNING: ${result.scopeWarning}`);
  }
  console.log('next: enqueue a backfill with pnpm worker:sync', tenantId, 'backfill');
}

main()
  .then(() => closeDbPools())
  .catch(async (err) => {
    console.error('connect failed:', err instanceof Error ? err.message : err);
    await closeDbPools();
    process.exit(1);
  });
