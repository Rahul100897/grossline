// Connecting a store is configuration, not code: give this function a tenant,
// a myshopify domain and a read-only custom-app token, and it verifies the
// token, records the store's own timezone/currency (CLAUDE.md #5), encrypts
// the token, and creates the connection.
import { z } from 'zod';
import { logger } from '@grossline/core';
import { createConnection, createStore, putCredential } from '@grossline/db';
import type { SyncContext } from '../types';
import { shopifyGraphQL } from './client';
import { SHOP_INFO_QUERY } from './queries';

const shopInfoSchema = z.object({
  shop: z.object({
    name: z.string(),
    myshopifyDomain: z.string(),
    ianaTimezone: z.string(),
    currencyCode: z.string(),
  }),
});

export async function connectShopifyStore(input: {
  tenantId: string;
  shopDomain: string;
  accessToken: string;
  fetchImpl?: typeof fetch;
}): Promise<{ storeId: string; connectionId: string }> {
  const ctx: SyncContext = {
    tenantId: input.tenantId,
    connectionId: 'not-yet-created',
    fetchImpl: input.fetchImpl ?? fetch,
    log: logger,
  };
  const creds = { shopDomain: input.shopDomain, accessToken: input.accessToken };

  // Verify the token and read the store's own timezone and currency.
  const info = shopInfoSchema.parse(await shopifyGraphQL(ctx, creds, SHOP_INFO_QUERY));

  const store = await createStore({
    tenantId: input.tenantId,
    shopDomain: info.shop.myshopifyDomain,
    storeCurrency: info.shop.currencyCode,
    storeTimezone: info.shop.ianaTimezone,
  });

  const credentialRef = await putCredential(input.tenantId, 'shopify', {
    shopDomain: info.shop.myshopifyDomain,
    accessToken: input.accessToken,
  });

  const connection = await createConnection({
    tenantId: input.tenantId,
    storeId: store.id,
    provider: 'shopify',
    externalAccountId: info.shop.myshopifyDomain,
    credentialRef,
    accountTimezone: info.shop.ianaTimezone,
    accountCurrency: info.shop.currencyCode,
  });

  logger.info('shopify store connected', {
    tenantId: input.tenantId,
    shopDomain: info.shop.myshopifyDomain,
    timezone: info.shop.ianaTimezone,
    currency: info.shop.currencyCode,
  });
  return { storeId: store.id, connectionId: connection.id };
}
