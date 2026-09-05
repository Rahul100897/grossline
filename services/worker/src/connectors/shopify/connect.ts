// Connecting a store is configuration, not code. Two strategies connect here
// directly; the third (authorization_code) starts here as an install URL and
// completes in the admin app's OAuth callback.
//
//   legacy_static       existing admin-created custom app token (shpat_)
//   client_credentials  Dev Dashboard app + store in our own organization
//   authorization_code  merchant store via custom distribution (install URL)
import { z } from 'zod';
import { logger } from '@grossline/core';
import {
  createConnection,
  createStore,
  putCredential,
  updateConnectionHealth,
  updateConnectionSettings,
} from '@grossline/db';
import type { SyncContext } from '../types';
import { shopifyGraphQL, type ShopifyCredentials } from './client';
import { SHOP_INFO_QUERY } from './queries';
import { resolveShopifyAccess, type ShopifyAuthStrategy } from './auth';
import { orderHistoryWarning } from './scopes';

const shopInfoSchema = z.object({
  shop: z.object({
    name: z.string(),
    myshopifyDomain: z.string(),
    ianaTimezone: z.string(),
    currencyCode: z.string(),
  }),
});

export type ConnectShopifyInput = {
  tenantId: string;
  shopDomain: string;
  strategy: ShopifyAuthStrategy;
  /** legacy_static / authorization_code */
  accessToken?: string;
  /** client_credentials */
  clientId?: string;
  clientSecret?: string;
  fetchImpl?: typeof fetch;
};

function credentialPayloadFor(input: ConnectShopifyInput): Record<string, unknown> {
  switch (input.strategy) {
    case 'legacy_static':
    case 'authorization_code': {
      if (!input.accessToken) throw new Error(`${input.strategy} needs accessToken`);
      return { shopDomain: input.shopDomain, accessToken: input.accessToken };
    }
    case 'client_credentials': {
      if (!input.clientId || !input.clientSecret) {
        throw new Error('client_credentials needs clientId and clientSecret');
      }
      // Deliberately no token here: client_credentials tokens expire in ~24h
      // and are re-derivable, so we store only what derives them.
      return {
        shopDomain: input.shopDomain,
        clientId: input.clientId,
        clientSecret: input.clientSecret,
      };
    }
  }
}

export async function connectShopifyStore(
  input: ConnectShopifyInput,
): Promise<{ storeId: string; connectionId: string; scopeWarning: string | null }> {
  const ctx: SyncContext = {
    tenantId: input.tenantId,
    connectionId: 'not-yet-created',
    fetchImpl: input.fetchImpl ?? fetch,
    log: logger,
  };
  const payload = credentialPayloadFor(input);

  // Resolving access validates the credential (for client_credentials this
  // performs the actual grant); the shop query validates the token works.
  const creds: ShopifyCredentials = await resolveShopifyAccess(ctx, input.strategy, payload);
  const info = shopInfoSchema.parse(await shopifyGraphQL(ctx, creds, SHOP_INFO_QUERY));
  const scopeWarning = await orderHistoryWarning(ctx, creds);

  const store = await createStore({
    tenantId: input.tenantId,
    shopDomain: info.shop.myshopifyDomain,
    storeCurrency: info.shop.currencyCode,
    storeTimezone: info.shop.ianaTimezone,
  });

  const credentialRef = await putCredential(input.tenantId, 'shopify', {
    ...payload,
    shopDomain: info.shop.myshopifyDomain,
  });

  const connection = await createConnection({
    tenantId: input.tenantId,
    storeId: store.id,
    provider: 'shopify',
    externalAccountId: info.shop.myshopifyDomain,
    credentialRef,
    accountTimezone: info.shop.ianaTimezone,
    accountCurrency: info.shop.currencyCode,
    settings: {
      authStrategy: input.strategy,
      ...(scopeWarning ? { scopeWarning } : {}),
    },
  });

  if (scopeWarning) {
    await updateConnectionHealth(input.tenantId, connection.id, {
      health: 'degraded',
      lastError: `warning: ${scopeWarning}`,
    });
  }

  logger.info('shopify store connected', {
    tenantId: input.tenantId,
    shopDomain: info.shop.myshopifyDomain,
    strategy: input.strategy,
    timezone: info.shop.ianaTimezone,
    currency: info.shop.currencyCode,
    scopeWarning: scopeWarning !== null,
  });
  return { storeId: store.id, connectionId: connection.id, scopeWarning };
}

/** Re-evaluate the scope warning (e.g. after read_all_orders is granted). */
export async function refreshShopifyScopeWarning(
  ctx: SyncContext,
  connectionId: string,
  creds: ShopifyCredentials,
  currentSettings: Record<string, unknown>,
): Promise<string | null> {
  const warning = await orderHistoryWarning(ctx, creds);
  const next = { ...currentSettings };
  if (warning) next.scopeWarning = warning;
  else delete next.scopeWarning;
  await updateConnectionSettings(ctx.tenantId, connectionId, { settings: next });
  return warning;
}
