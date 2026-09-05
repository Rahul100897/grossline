// Shopify auth strategies (docs/decisions.md, Shopify auth changes 2026):
//
//   legacy_static       admin-created custom app shpat_ token — cannot be
//                       created since 2026-01-01, existing ones still work
//   client_credentials  Dev Dashboard app + store in OUR OWN Shopify
//                       organization; short-lived (~24h) tokens fetched on
//                       demand, cached in memory, refreshed proactively,
//                       never persisted and never logged
//   authorization_code  Dev Dashboard app with custom distribution installed
//                       on a merchant store; offline token stored encrypted
//
// The strategy lives on the connection row (settings.authStrategy); rows from
// before this change have none and default to legacy_static.
import { z } from 'zod';
import { fetchWithRetry } from '../http';
import type { SyncContext } from '../types';
import type { ShopifyCredentials } from './client';

export const shopifyAuthStrategySchema = z.enum([
  'legacy_static',
  'client_credentials',
  'authorization_code',
]);
export type ShopifyAuthStrategy = z.infer<typeof shopifyAuthStrategySchema>;

/** legacy_static and authorization_code both persist a long-lived token. */
const staticTokenPayloadSchema = z
  .object({ shopDomain: z.string().min(1), accessToken: z.string().min(1) })
  .passthrough();

const clientCredentialsPayloadSchema = z
  .object({
    shopDomain: z.string().min(1),
    clientId: z.string().min(1),
    clientSecret: z.string().min(1),
  })
  .passthrough();

const tokenResponseSchema = z.object({
  access_token: z.string(),
  expires_in: z.number(),
  scope: z.string().optional(),
});

/** Refresh this long before expiry so a long sync never runs off a dying token. */
const REFRESH_WINDOW_MS = 5 * 60_000;

type CachedToken = { accessToken: string; expiresAt: number };
const tokenCache = new Map<string, CachedToken>();

export function clearShopifyTokenCache(): void {
  tokenCache.clear();
}

async function fetchClientCredentialsToken(
  ctx: SyncContext,
  payload: z.infer<typeof clientCredentialsPayloadSchema>,
): Promise<CachedToken> {
  const res = await fetchWithRetry(
    `https://${payload.shopDomain}/admin/oauth/access_token`,
    {
      method: 'POST',
      headers: { 'content-type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        grant_type: 'client_credentials',
        client_id: payload.clientId,
        client_secret: payload.clientSecret,
      }).toString(),
    },
    { fetchImpl: ctx.fetchImpl },
  );
  if (!res.ok) {
    // Body deliberately not logged/attached wholesale — it may echo credentials.
    throw new Error(`shopify client_credentials grant failed: HTTP ${res.status}`);
  }
  const token = tokenResponseSchema.parse(await res.json());
  return {
    accessToken: token.access_token,
    expiresAt: Date.now() + token.expires_in * 1000,
  };
}

/**
 * Resolve credentials + strategy into something the GraphQL client can use.
 * client_credentials tokens are re-derivable, so they live only in this
 * in-memory cache — never in the database, never in a log line.
 */
export async function resolveShopifyAccess(
  ctx: SyncContext,
  strategy: ShopifyAuthStrategy,
  credentialPayload: Record<string, unknown>,
): Promise<ShopifyCredentials> {
  if (strategy === 'legacy_static' || strategy === 'authorization_code') {
    const payload = staticTokenPayloadSchema.parse(credentialPayload);
    return { shopDomain: payload.shopDomain, accessToken: payload.accessToken };
  }

  const payload = clientCredentialsPayloadSchema.parse(credentialPayload);
  const cacheKey = `${payload.shopDomain}:${payload.clientId}`;
  const cached = tokenCache.get(cacheKey);
  if (cached && cached.expiresAt - REFRESH_WINDOW_MS > Date.now()) {
    return { shopDomain: payload.shopDomain, accessToken: cached.accessToken };
  }
  const fresh = await fetchClientCredentialsToken(ctx, payload);
  tokenCache.set(cacheKey, fresh);
  return { shopDomain: payload.shopDomain, accessToken: fresh.accessToken };
}

export function strategyFromConnectionSettings(settings: unknown): ShopifyAuthStrategy {
  const raw = ((settings ?? {}) as Record<string, unknown>).authStrategy;
  const parsed = shopifyAuthStrategySchema.safeParse(raw);
  // Connections created before strategies existed are legacy custom apps.
  return parsed.success ? parsed.data : 'legacy_static';
}
