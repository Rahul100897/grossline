// Completion of Shopify's authorization code grant (merchant stores via
// custom distribution). The worker CLI prints the install URL; the merchant
// approves; Shopify redirects to /api/shopify/callback; this module validates
// and finishes: exchange the code for an offline token, read the shop's
// timezone/currency, store everything encrypted.
import { z } from 'zod';
import {
  READ_ALL_ORDERS_WARNING,
  isValidShopDomain,
  verifyShopifyHmac,
  verifySessionToken,
} from '@grossline/core';
import {
  createConnection,
  createStore,
  putCredential,
  updateConnectionHealth,
} from '@grossline/db';

function oauthClientId(): string {
  const id = process.env.SHOPIFY_CLIENT_ID ?? process.env.SHOPIFY_API_KEY;
  if (!id) throw new Error('SHOPIFY_CLIENT_ID (or SHOPIFY_API_KEY) is not set');
  return id;
}

function oauthClientSecret(): string {
  const secret = process.env.SHOPIFY_CLIENT_SECRET ?? process.env.SHOPIFY_API_SECRET;
  if (!secret) throw new Error('SHOPIFY_CLIENT_SECRET (or SHOPIFY_API_SECRET) is not set');
  return secret;
}

const tokenResponseSchema = z.object({
  access_token: z.string(),
  scope: z.string(),
});

const shopInfoSchema = z.object({
  data: z.object({
    shop: z.object({
      myshopifyDomain: z.string(),
      ianaTimezone: z.string(),
      currencyCode: z.string(),
    }),
  }),
});

export type CallbackResult =
  | { ok: true; connectionId: string; scopeWarning: string | null }
  | { ok: false; status: number; reason: string };

/**
 * Validate and complete the OAuth callback. Pure-ish: everything external is
 * the injected fetch plus env; returns a result instead of throwing so the
 * route can map it to a response.
 */
export async function handleShopifyCallback(
  params: Record<string, string>,
  fetchImpl: typeof fetch = fetch,
): Promise<CallbackResult> {
  const { shop, code, state } = params;
  if (!shop || !code || !state) return { ok: false, status: 400, reason: 'missing parameters' };
  if (!isValidShopDomain(shop)) return { ok: false, status: 400, reason: 'invalid shop domain' };
  if (!verifyShopifyHmac(params, oauthClientSecret())) {
    return { ok: false, status: 401, reason: 'hmac verification failed' };
  }
  const sessionSecret = process.env.SESSION_SECRET;
  if (!sessionSecret) return { ok: false, status: 500, reason: 'SESSION_SECRET not set' };
  const statePayload = await verifySessionToken(state, sessionSecret);
  if (!statePayload) return { ok: false, status: 401, reason: 'state invalid or expired' };
  const tenantId = statePayload.sub;

  // Exchange the code for an offline access token.
  const tokenRes = await fetchImpl(`https://${shop}/admin/oauth/access_token`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      client_id: oauthClientId(),
      client_secret: oauthClientSecret(),
      code,
    }),
  });
  if (!tokenRes.ok) {
    return { ok: false, status: 502, reason: `token exchange failed: HTTP ${tokenRes.status}` };
  }
  const token = tokenResponseSchema.parse(await tokenRes.json());
  const grantedScopes = token.scope.split(',').map((s) => s.trim());
  const scopeWarning = grantedScopes.includes('read_all_orders') ? null : READ_ALL_ORDERS_WARNING;

  // Record the store's own timezone and currency at connect time.
  const version = process.env.SHOPIFY_API_VERSION || '2026-07';
  const shopRes = await fetchImpl(`https://${shop}/admin/api/${version}/graphql.json`, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      'x-shopify-access-token': token.access_token,
    },
    body: JSON.stringify({ query: '{ shop { myshopifyDomain ianaTimezone currencyCode } }' }),
  });
  if (!shopRes.ok) {
    return { ok: false, status: 502, reason: `shop query failed: HTTP ${shopRes.status}` };
  }
  const info = shopInfoSchema.parse(await shopRes.json()).data.shop;

  const store = await createStore({
    tenantId,
    shopDomain: info.myshopifyDomain,
    storeCurrency: info.currencyCode,
    storeTimezone: info.ianaTimezone,
  });
  // Offline tokens cannot be re-derived — stored, encrypted, like any credential.
  const credentialRef = await putCredential(tenantId, 'shopify', {
    shopDomain: info.myshopifyDomain,
    accessToken: token.access_token,
  });
  const connection = await createConnection({
    tenantId,
    storeId: store.id,
    provider: 'shopify',
    externalAccountId: info.myshopifyDomain,
    credentialRef,
    accountTimezone: info.ianaTimezone,
    accountCurrency: info.currencyCode,
    settings: {
      authStrategy: 'authorization_code',
      grantedScopes,
      ...(scopeWarning ? { scopeWarning } : {}),
    },
  });
  if (scopeWarning) {
    await updateConnectionHealth(tenantId, connection.id, {
      health: 'degraded',
      lastError: `warning: ${scopeWarning}`,
    });
  }
  return { ok: true, connectionId: connection.id, scopeWarning };
}
