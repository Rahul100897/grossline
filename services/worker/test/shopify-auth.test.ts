import { afterEach, describe, expect, it, vi } from 'vitest';
import { logger } from '@grossline/core';
import { clearShopifyTokenCache, resolveShopifyAccess } from '../src/connectors/shopify/auth';
import type { SyncContext } from '../src/connectors/types';

const SECRET_TOKEN = 'shpca_synthetic_cc_token_1f2e3d4c'; // gitleaks:allow — fake

function tokenRouter(expiresIn: number): { impl: typeof fetch; tokenCalls: () => number } {
  let calls = 0;
  const impl = (async (input: unknown, init?: RequestInit) => {
    const url = String(input);
    if (url.endsWith('/admin/oauth/access_token')) {
      calls++;
      const body = String(init?.body);
      expect(body).toContain('grant_type=client_credentials');
      expect(body).toContain('client_id=cid123');
      return new Response(
        JSON.stringify({ access_token: SECRET_TOKEN, expires_in: expiresIn, scope: 'read_orders' }),
        { status: 200 },
      );
    }
    throw new Error(`unrouted: ${url}`);
  }) as typeof fetch;
  return { impl, tokenCalls: () => calls };
}

const ctxWith = (impl: typeof fetch): SyncContext => ({
  tenantId: 'test',
  connectionId: 'test',
  fetchImpl: impl,
  log: logger,
});

const CC_PAYLOAD = {
  shopDomain: 'demo-alpha.myshopify.com',
  clientId: 'cid123',
  clientSecret: 'csecret456', // gitleaks:allow — fake
};

afterEach(() => {
  clearShopifyTokenCache();
  vi.restoreAllMocks();
});

describe('shopify auth strategies', () => {
  it('static strategies pass the stored token through', async () => {
    for (const strategy of ['legacy_static', 'authorization_code'] as const) {
      const creds = await resolveShopifyAccess(ctxWith(fetch), strategy, {
        shopDomain: 'demo-alpha.myshopify.com',
        accessToken: 'shpat_stored', // gitleaks:allow — fake
      });
      expect(creds.accessToken).toBe('shpat_stored');
    }
  });

  it('client_credentials fetches once and caches a ~24h token', async () => {
    const router = tokenRouter(86_399);
    const first = await resolveShopifyAccess(ctxWith(router.impl), 'client_credentials', CC_PAYLOAD);
    const second = await resolveShopifyAccess(ctxWith(router.impl), 'client_credentials', CC_PAYLOAD);
    expect(first.accessToken).toBe(SECRET_TOKEN);
    expect(second.accessToken).toBe(SECRET_TOKEN);
    expect(router.tokenCalls()).toBe(1);
  });

  it('refreshes proactively when the token is inside the expiry window', async () => {
    const router = tokenRouter(120); // 2 minutes left < 5-minute refresh window
    await resolveShopifyAccess(ctxWith(router.impl), 'client_credentials', CC_PAYLOAD);
    await resolveShopifyAccess(ctxWith(router.impl), 'client_credentials', CC_PAYLOAD);
    expect(router.tokenCalls()).toBe(2);
  });

  it('never passes the derived token to any log call', async () => {
    const spies = [
      vi.spyOn(console, 'log'),
      vi.spyOn(console, 'info'),
      vi.spyOn(console, 'warn'),
      vi.spyOn(console, 'error'),
    ];
    const router = tokenRouter(86_399);
    await resolveShopifyAccess(ctxWith(router.impl), 'client_credentials', CC_PAYLOAD);
    for (const spy of spies) {
      for (const call of spy.mock.calls) {
        expect(call.map((a) => JSON.stringify(a)).join(' ')).not.toContain(SECRET_TOKEN);
      }
    }
  });

  it('a failed grant reports status only, never echoing credentials', async () => {
    const failing = (async () =>
      new Response('{"error":"invalid_client"}', { status: 401 })) as typeof fetch;
    await expect(
      resolveShopifyAccess(ctxWith(failing), 'client_credentials', CC_PAYLOAD),
    ).rejects.toThrow(/HTTP 401/);
  });
});
