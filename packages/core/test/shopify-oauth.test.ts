import { createHmac } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import {
  buildShopifyInstallUrl,
  isValidShopDomain,
  verifyShopifyHmac,
} from '../src/auth/shopify-oauth';

describe('isValidShopDomain', () => {
  it('accepts myshopify domains and rejects lookalikes', () => {
    expect(isValidShopDomain('demo-alpha.myshopify.com')).toBe(true);
    expect(isValidShopDomain('demo.myshopify.com.evil.example')).toBe(false);
    expect(isValidShopDomain('evil.example/?x=.myshopify.com')).toBe(false);
    expect(isValidShopDomain('-bad.myshopify.com')).toBe(false);
  });
});

describe('buildShopifyInstallUrl', () => {
  it('builds the authorize URL with scopes, redirect and state', () => {
    const url = new URL(
      buildShopifyInstallUrl({
        shopDomain: 'demo-alpha.myshopify.com',
        clientId: 'client123',
        scopes: ['read_orders', 'read_all_orders'],
        redirectUri: 'http://localhost:3000/api/shopify/callback',
        state: 'state-token',
      }),
    );
    expect(url.origin + url.pathname).toBe('https://demo-alpha.myshopify.com/admin/oauth/authorize');
    expect(url.searchParams.get('client_id')).toBe('client123');
    expect(url.searchParams.get('scope')).toBe('read_orders,read_all_orders');
    expect(url.searchParams.get('redirect_uri')).toBe('http://localhost:3000/api/shopify/callback');
    expect(url.searchParams.get('state')).toBe('state-token');
  });

  it('refuses non-myshopify domains', () => {
    expect(() =>
      buildShopifyInstallUrl({
        shopDomain: 'evil.example',
        clientId: 'x',
        scopes: [],
        redirectUri: 'http://localhost',
        state: 's',
      }),
    ).toThrow(/myshopify/);
  });
});

describe('verifyShopifyHmac', () => {
  const secret = 'shpss_test_secret'; // gitleaks:allow — fake

  const sign = (params: Record<string, string>) => {
    const message = Object.keys(params)
      .sort()
      .map((k) => `${k}=${params[k]}`)
      .join('&');
    return createHmac('sha256', secret).update(message).digest('hex');
  };

  it('accepts a correctly signed callback and rejects tampering', () => {
    const params = {
      code: 'abc123',
      shop: 'demo-alpha.myshopify.com',
      state: 'state-token',
      timestamp: '1757100000',
    };
    const hmac = sign(params);
    expect(verifyShopifyHmac({ ...params, hmac }, secret)).toBe(true);
    expect(verifyShopifyHmac({ ...params, shop: 'other.myshopify.com', hmac }, secret)).toBe(false);
    expect(verifyShopifyHmac({ ...params, hmac: hmac.replace(/^./, '0') }, secret)).toBe(false);
    expect(verifyShopifyHmac({ ...params }, secret)).toBe(false); // missing hmac
    expect(verifyShopifyHmac({ ...params, hmac }, 'wrong-secret')).toBe(false);
  });
});
