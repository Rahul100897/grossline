import { readFileSync } from 'node:fs';
import { randomUUID } from 'node:crypto';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { and, eq } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { logger } from '@grossline/core';
import {
  clearCursors,
  closeDbPools,
  countRawGoogleAdsInsights,
  createTenant,
  getConnection,
  schema,
  withTenant,
} from '@grossline/db';
import {
  GoogleAdsUnlinkedAccountError,
  clearGoogleTokenCache,
} from '../src/connectors/google-ads/client';
import { campaignDaysQuery, googleAdsConnector } from '../src/connectors/google-ads/connector';
import { connectGoogleAdsAccount } from '../src/connectors/google-ads/connect';
import { runBackfill } from '../src/connectors/engine';
import type { SyncContext } from '../src/connectors/types';

process.env.GOOGLE_ADS_DEVELOPER_TOKEN = 'synthetic-dev-token'; // gitleaks:allow — fake
process.env.GOOGLE_ADS_CLIENT_ID = 'synthetic-client-id.apps.googleusercontent.com';
process.env.GOOGLE_ADS_CLIENT_SECRET = 'synthetic-client-secret'; // gitleaks:allow — fake

const fixturesDir = join(dirname(fileURLToPath(import.meta.url)), 'fixtures', 'google-ads');
const fixture = (name: string) => readFileSync(join(fixturesDir, name), 'utf8');

type Recorded = { url: string; headers: Record<string, string>; body: string };

function makeRouter(opts: { unlinked?: boolean } = {}): {
  impl: typeof fetch;
  requests: Recorded[];
  tokenCalls: () => number;
} {
  const requests: Recorded[] = [];
  let tokenCalls = 0;
  const impl = (async (input: unknown, init?: RequestInit) => {
    const url = String(input);
    const headers = Object.fromEntries(
      Object.entries((init?.headers ?? {}) as Record<string, string>).map(([k, v]) => [
        k.toLowerCase(),
        v,
      ]),
    );
    requests.push({ url, headers, body: String(init?.body ?? '') });

    if (url.startsWith('https://oauth2.googleapis.com/token')) {
      tokenCalls++;
      return new Response(
        JSON.stringify({ access_token: 'ya29.synthetic', expires_in: 3600, token_type: 'Bearer' }), // gitleaks:allow
        { status: 200 },
      );
    }
    if (url.includes('googleAds:searchStream')) {
      if (opts.unlinked) {
        return new Response(fixture('synthetic-unlinked-error.json'), { status: 403 });
      }
      const body = JSON.parse(String(init?.body)) as { query: string };
      if (body.query.includes('FROM customer')) {
        return new Response(fixture('synthetic-customer-info.json'), { status: 200 });
      }
      return new Response(fixture('synthetic-searchstream-campaigns.json'), { status: 200 });
    }
    throw new Error(`unrouted url: ${url}`);
  }) as typeof fetch;
  return { impl, requests, tokenCalls: () => tokenCalls };
}

let tenantId: string;
let connectionId: string;
const router = makeRouter();

const ctx = (): SyncContext => ({
  tenantId,
  connectionId,
  fetchImpl: router.impl,
  log: logger,
});

beforeAll(async () => {
  clearGoogleTokenCache();
  tenantId = (
    await createTenant({
      name: 'Google fixture tenant',
      slug: `gads-${randomUUID().slice(0, 8)}`,
      reportingCurrency: 'USD',
      reportingTimezone: 'America/New_York',
    })
  ).id;
  const connected = await connectGoogleAdsAccount({
    tenantId,
    customerId: '987-654-3210',
    loginCustomerId: '111-222-3333',
    refreshToken: '1//synthetic-refresh-token', // gitleaks:allow — fake
    fetchImpl: router.impl,
  });
  connectionId = connected.connectionId;
  expect(connected.linked).toBe(true);
});

afterAll(async () => {
  await closeDbPools();
});

describe('google ads connect flow', () => {
  it('records currency, timezone and a digits-only MCC id', async () => {
    const connection = await getConnection(tenantId, connectionId);
    expect(connection!.accountCurrency).toBe('USD');
    expect(connection!.accountTimezone).toBe('America/New_York');
    expect(connection!.externalAccountId).toBe('9876543210');
    expect((connection!.settings as Record<string, unknown>).loginCustomerId).toBe('1112223333');
  });
});

describe('gaql', () => {
  it('converts a half-open window to an inclusive BETWEEN', () => {
    const q = campaignDaysQuery(new Date('2026-02-01T00:00:00Z'), new Date('2026-03-01T00:00:00Z'));
    expect(q).toContain("BETWEEN '2026-02-01' AND '2026-02-28'");
    expect(q).toContain('metrics.cost_micros');
  });
});

describe('google ads backfill', () => {
  it('lands daily campaign rows; a re-run writes zero duplicates', async () => {
    const window = {
      start: new Date('2026-02-01T00:00:00Z'),
      end: new Date('2026-03-01T00:00:00Z'),
    };
    await runBackfill(ctx(), googleAdsConnector, window);
    expect(await countRawGoogleAdsInsights(tenantId)).toBe(6);

    await clearCursors(tenantId, connectionId);
    await runBackfill(ctx(), googleAdsConnector, window);
    expect(await countRawGoogleAdsInsights(tenantId)).toBe(6);
  });

  it('keeps zero-cost days and stores cost_micros untouched', async () => {
    const [zeroDay] = await withTenant(tenantId, (tx) =>
      tx
        .select()
        .from(schema.rawGoogleAdsInsights)
        .where(
          and(
            eq(schema.rawGoogleAdsInsights.campaignId, '22222222222'),
            eq(schema.rawGoogleAdsInsights.date, '2026-02-02'),
          ),
        ),
    );
    const metrics = (zeroDay!.payload as Record<string, unknown>).metrics as Record<string, unknown>;
    expect(metrics.costMicros).toBe('0');
  });

  it('sends login-customer-id and developer-token on every API call, with one cached token fetch', () => {
    const apiCalls = router.requests.filter((r) => r.url.includes('googleAds:searchStream'));
    expect(apiCalls.length).toBeGreaterThan(0);
    for (const call of apiCalls) {
      expect(call.headers['login-customer-id']).toBe('1112223333');
      expect(call.headers['developer-token']).toBe('synthetic-dev-token');
      expect(call.headers.authorization).toBe('Bearer ya29.synthetic');
    }
    expect(router.tokenCalls()).toBe(1);
  });
});

describe('unlinked account handling', () => {
  it('connect still records the connection, marked broken with the linking instruction', async () => {
    const unlinkedRouter = makeRouter({ unlinked: true });
    const { connectionId: brokenId, linked } = await connectGoogleAdsAccount({
      tenantId,
      customerId: '555-000-1111',
      loginCustomerId: '111-222-3333',
      refreshToken: '1//synthetic-refresh-token-2', // gitleaks:allow — fake
      fetchImpl: unlinkedRouter.impl,
    });
    expect(linked).toBe(false);
    const connection = await getConnection(tenantId, brokenId);
    expect(connection!.health).toBe('broken');
    expect(connection!.lastError).toMatch(/link the client account/i);

    // A sync attempt is a typed error plus broken health — never a crash loop.
    const brokenCtx: SyncContext = {
      tenantId,
      connectionId: brokenId,
      fetchImpl: unlinkedRouter.impl,
      log: logger,
    };
    await expect(
      googleAdsConnector.backfillChunk(brokenCtx, 'campaign', {
        start: new Date('2026-02-01T00:00:00Z'),
        end: new Date('2026-03-01T00:00:00Z'),
      }),
    ).rejects.toThrow(GoogleAdsUnlinkedAccountError);

    const health = await googleAdsConnector.health(brokenCtx);
    expect(health.healthy).toBe(false);
    expect(health.detail).toMatch(/link the client account/i);
  });
});
