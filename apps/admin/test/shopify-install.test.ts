import { createHmac, randomUUID } from 'node:crypto';
import { beforeAll, afterAll, describe, expect, it } from 'vitest';
import { createSessionToken } from '@grossline/core';
import { closeDbPools, createTenant, getConnection, getCredential, listStores } from '@grossline/db';
import { handleShopifyCallback } from '../lib/shopify-install';

const CLIENT_SECRET = 'shpss_synthetic_secret'; // gitleaks:allow — fake
const SESSION_SECRET = 'test-session-secret';
const OFFLINE_TOKEN = 'shpat_offline_synthetic_9a8b7c'; // gitleaks:allow — fake

process.env.SHOPIFY_CLIENT_ID = 'cid-oauth-test';
process.env.SHOPIFY_CLIENT_SECRET = CLIENT_SECRET;
process.env.SESSION_SECRET = SESSION_SECRET;

const SHOP = 'demo-merchant.myshopify.com';

function signParams(params: Record<string, string>): Record<string, string> {
  const message = Object.keys(params)
    .sort()
    .map((k) => `${k}=${params[k]}`)
    .join('&');
  return { ...params, hmac: createHmac('sha256', CLIENT_SECRET).update(message).digest('hex') };
}

function makeFetch(opts: { scope: string }): typeof fetch {
  return (async (input: unknown, init?: RequestInit) => {
    const url = String(input);
    if (url.endsWith('/admin/oauth/access_token')) {
      const body = JSON.parse(String(init?.body)) as Record<string, string>;
      expect(body.code).toBe('authcode123');
      expect(body.client_id).toBe('cid-oauth-test');
      return new Response(JSON.stringify({ access_token: OFFLINE_TOKEN, scope: opts.scope }), {
        status: 200,
      });
    }
    if (url.includes('/graphql.json')) {
      return new Response(
        JSON.stringify({
          data: {
            shop: { myshopifyDomain: SHOP, ianaTimezone: 'Europe/Berlin', currencyCode: 'EUR' },
          },
        }),
        { status: 200 },
      );
    }
    throw new Error(`unrouted: ${url}`);
  }) as typeof fetch;
}

let tenantId: string;

beforeAll(async () => {
  tenantId = (
    await createTenant({
      name: 'OAuth tenant',
      slug: `oauth-${randomUUID().slice(0, 8)}`,
      reportingCurrency: 'EUR',
      reportingTimezone: 'Europe/Berlin',
    })
  ).id;
});

afterAll(async () => {
  await closeDbPools();
});

async function validState(): Promise<string> {
  return createSessionToken({ sub: tenantId, exp: Date.now() + 60_000 }, SESSION_SECRET);
}

describe('shopify oauth callback', () => {
  it('completes the install: offline token encrypted, store recorded, strategy set', async () => {
    const params = signParams({
      shop: SHOP,
      code: 'authcode123',
      state: await validState(),
      timestamp: '1757100000',
    });
    const result = await handleShopifyCallback(
      params,
      makeFetch({ scope: 'read_orders,read_all_orders,read_customers,read_products,read_inventory' }),
    );
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.scopeWarning).toBeNull();

    const connection = await getConnection(tenantId, result.connectionId);
    expect((connection!.settings as Record<string, unknown>).authStrategy).toBe(
      'authorization_code',
    );
    expect(connection!.health).toBe('unknown'); // no sync yet — no fake health
    expect(connection!.accountTimezone).toBe('Europe/Berlin');
    expect(connection!.accountCurrency).toBe('EUR');

    const stores = await listStores(tenantId);
    expect(stores.some((s) => s.shopDomain === SHOP && s.storeTimezone === 'Europe/Berlin')).toBe(
      true,
    );

    const credential = await getCredential(tenantId, connection!.credentialRef!);
    expect(credential!.payload.accessToken).toBe(OFFLINE_TOKEN); // offline token: not re-derivable, stored encrypted
  });

  it('flags the 60-day order window when read_all_orders was not granted', async () => {
    const params = signParams({
      shop: SHOP,
      code: 'authcode123',
      state: await validState(),
      timestamp: '1757100001',
    });
    const result = await handleShopifyCallback(params, makeFetch({ scope: 'read_orders' }));
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.scopeWarning).toMatch(/60 days/);
    const connection = await getConnection(tenantId, result.connectionId);
    expect(connection!.health).toBe('degraded');
    expect(connection!.lastError).toMatch(/60 days/);
  });

  it('rejects a tampered hmac, a bad shop domain and an expired state', async () => {
    const good = signParams({
      shop: SHOP,
      code: 'authcode123',
      state: await validState(),
      timestamp: '1757100002',
    });
    const tampered = await handleShopifyCallback(
      { ...good, hmac: good.hmac!.replace(/^./, '0') },
      makeFetch({ scope: 'read_orders' }),
    );
    expect(tampered).toMatchObject({ ok: false, status: 401 });

    const badShop = await handleShopifyCallback(
      signParams({ ...good, shop: 'evil.example' }),
      makeFetch({ scope: 'read_orders' }),
    );
    expect(badShop).toMatchObject({ ok: false, status: 400 });

    const expiredState = await createSessionToken(
      { sub: tenantId, exp: Date.now() - 1 },
      SESSION_SECRET,
    );
    const expired = await handleShopifyCallback(
      signParams({ shop: SHOP, code: 'authcode123', state: expiredState, timestamp: '1757100003' }),
      makeFetch({ scope: 'read_orders' }),
    );
    expect(expired).toMatchObject({ ok: false, status: 401 });
  });
});
