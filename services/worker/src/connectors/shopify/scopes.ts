// read_all_orders is a restricted scope. Without it Shopify silently limits
// order queries to the trailing 60 days — a short backfill with no error.
// We surface that as a connection health warning instead of letting it pass.
import { z } from 'zod';
import { READ_ALL_ORDERS_WARNING } from '@grossline/core';
import type { SyncContext } from '../types';
import { shopifyGraphQL, type ShopifyCredentials } from './client';

export { READ_ALL_ORDERS_WARNING };

const scopesSchema = z.object({
  currentAppInstallation: z.object({
    accessScopes: z.array(z.object({ handle: z.string() })),
  }),
});

export async function grantedScopes(
  ctx: SyncContext,
  creds: ShopifyCredentials,
): Promise<string[]> {
  const data = scopesSchema.parse(
    await shopifyGraphQL(
      ctx,
      creds,
      `{ currentAppInstallation { accessScopes { handle } } }`,
    ),
  );
  return data.currentAppInstallation.accessScopes.map((s) => s.handle);
}

/** Null when order history is fully accessible; the warning text otherwise. */
export async function orderHistoryWarning(
  ctx: SyncContext,
  creds: ShopifyCredentials,
): Promise<string | null> {
  const scopes = await grantedScopes(ctx, creds);
  return scopes.includes('read_all_orders') ? null : READ_ALL_ORDERS_WARNING;
}
