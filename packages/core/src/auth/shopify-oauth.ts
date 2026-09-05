// Pure helpers for Shopify's authorization code grant (Dev Dashboard apps
// with custom distribution). Node crypto only, usable from both the admin
// app's callback route and the worker's connect CLI.
import { createHmac, timingSafeEqual } from 'node:crypto';

/** Anchored per shopify.dev — reject anything that is not a myshopify domain. */
export function isValidShopDomain(shop: string): boolean {
  return /^[a-zA-Z0-9][a-zA-Z0-9-]*\.myshopify\.com$/.test(shop);
}

export function buildShopifyInstallUrl(input: {
  shopDomain: string;
  clientId: string;
  scopes: string[];
  redirectUri: string;
  state: string;
}): string {
  if (!isValidShopDomain(input.shopDomain)) {
    throw new Error(`not a myshopify domain: ${input.shopDomain}`);
  }
  const params = new URLSearchParams({
    client_id: input.clientId,
    scope: input.scopes.join(','),
    redirect_uri: input.redirectUri,
    state: input.state,
  });
  return `https://${input.shopDomain}/admin/oauth/authorize?${params}`;
}

/**
 * Verify the callback's hmac parameter: remove `hmac`, sort the remaining
 * params alphabetically, HMAC-SHA256 with the client secret, constant-time
 * compare against the hex digest Shopify sent.
 */
export function verifyShopifyHmac(params: Record<string, string>, clientSecret: string): boolean {
  const { hmac, ...rest } = params;
  if (!hmac || !/^[0-9a-f]{64}$/i.test(hmac)) return false;
  const message = Object.keys(rest)
    .sort()
    .map((key) => `${key}=${rest[key]}`)
    .join('&');
  const digest = createHmac('sha256', clientSecret).update(message).digest('hex');
  return timingSafeEqual(Buffer.from(digest, 'utf8'), Buffer.from(hmac.toLowerCase(), 'utf8'));
}

/** The scopes Grossline requests. read_all_orders is restricted — see docs. */
export const SHOPIFY_OAUTH_SCOPES = [
  'read_orders',
  'read_all_orders',
  'read_customers',
  'read_products',
  'read_inventory',
];

/** Shown wherever the restricted scope is missing — never a silent 60-day backfill. */
export const READ_ALL_ORDERS_WARNING =
  'read_all_orders scope not granted: Shopify only returns the last 60 days of orders, ' +
  'so any backfill beyond 60 days is silently incomplete. Request the scope in the Dev ' +
  'Dashboard (API access → Read all orders), then re-run connect and the backfill.';

/**
 * Live-API finding (2026-09-05): a Dev Dashboard app whose *released version*
 * carries no scopes issues tokens with an empty scope set — shop info works,
 * every data field is "Access denied". The token's scope field and
 * currentAppInstallation.accessScopes both read back what the installed
 * version was approved with.
 */
export const NO_SCOPES_WARNING =
  'the installed app version has NO access scopes: every data query is denied. ' +
  'In the Dev Dashboard, select the scopes (read_orders, read_customers, read_products, ' +
  'read_inventory) on the app version, release it, approve the change on the store, ' +
  'then re-run connect.';

/** The right warning for a set of granted scopes, or null when all is well. */
export function shopifyScopeWarning(scopes: string[]): string | null {
  if (scopes.length === 0) return NO_SCOPES_WARNING;
  return scopes.includes('read_all_orders') ? null : READ_ALL_ORDERS_WARNING;
}
