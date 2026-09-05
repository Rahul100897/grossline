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
  countRawMetaInsights,
  createTenant,
  getConnection,
  schema,
  withTenant,
} from '@grossline/db';
import { metaConnector, insightsFieldsFor } from '../src/connectors/meta/connector';
import { connectMetaAccount } from '../src/connectors/meta/connect';
import { runBackfill, runIncremental } from '../src/connectors/engine';
import type { SyncContext } from '../src/connectors/types';

const fixturesDir = join(dirname(fileURLToPath(import.meta.url)), 'fixtures', 'meta');
const fixture = (name: string) => JSON.parse(readFileSync(join(fixturesDir, name), 'utf8'));

const json = (payload: unknown, headers: Record<string, string> = {}) =>
  new Response(JSON.stringify(payload), {
    status: 200,
    headers: { 'content-type': 'application/json', ...headers },
  });

type RouterState = { restated: boolean; requests: string[] };

function makeRouter(): { impl: typeof fetch; state: RouterState } {
  const state: RouterState = { restated: false, requests: [] };
  const impl = (async (input: unknown) => {
    const url = new URL(String(input));
    state.requests.push(url.toString());
    if (!url.hostname.includes('graph.facebook.com')) throw new Error(`unrouted host: ${url}`);
    if (url.pathname.endsWith('/insights')) {
      if (url.searchParams.get('after') === 'page2') {
        return json(fixture('synthetic-insights-campaign-page2.json'));
      }
      const level = url.searchParams.get('level');
      if (level === 'account') return json(fixture('synthetic-insights-account.json'));
      return json(
        fixture(
          state.restated
            ? 'synthetic-insights-campaign-restated.json'
            : 'synthetic-insights-campaign-page1.json',
        ),
      );
    }
    if (url.pathname.includes('act_123456789012345')) {
      return json(fixture('synthetic-account-info.json'));
    }
    throw new Error(`unrouted url: ${url}`);
  }) as typeof fetch;
  return { impl, state };
}

const router = makeRouter();
let tenantId: string;
let connectionId: string;

const ctx = (): SyncContext => ({
  tenantId,
  connectionId,
  fetchImpl: router.impl,
  log: logger,
});

beforeAll(async () => {
  tenantId = (
    await createTenant({
      name: 'Meta fixture tenant',
      slug: `meta-${randomUUID().slice(0, 8)}`,
      reportingCurrency: 'USD',
      reportingTimezone: 'America/New_York',
    })
  ).id;
  const connected = await connectMetaAccount({
    tenantId,
    adAccountId: 'act_123456789012345',
    accessToken: 'EAAsynthetic-test-token', // gitleaks:allow — fake token for fixtures
    fetchImpl: router.impl,
  });
  connectionId = connected.connectionId;
});

afterAll(async () => {
  await closeDbPools();
});

describe('meta connect flow', () => {
  it('records timezone, billing currency and attribution setting on the connection', async () => {
    const connection = await getConnection(tenantId, connectionId);
    expect(connection!.accountTimezone).toBe('America/Los_Angeles');
    expect(connection!.accountCurrency).toBe('USD');
    const settings = connection!.settings as Record<string, unknown>;
    expect(settings.attributionSpec).toEqual([
      { event_type: 'CLICK_THROUGH', window_days: 7 },
      { event_type: 'VIEW_THROUGH', window_days: 1 },
    ]);
  });
});

describe('meta backfill', () => {
  it('lands daily account and campaign rows; a re-run writes zero duplicates', async () => {
    const window = {
      start: new Date('2026-02-01T00:00:00Z'),
      end: new Date('2026-03-01T00:00:00Z'),
    };
    await runBackfill(ctx(), metaConnector, window);
    // 3 account days + 6 campaign day-rows (2 pages)
    expect(await countRawMetaInsights(tenantId)).toBe(9);

    await clearCursors(tenantId, connectionId);
    await runBackfill(ctx(), metaConnector, window);
    expect(await countRawMetaInsights(tenantId)).toBe(9);
  });

  it('stores the attribution setting alongside every row', async () => {
    const rows = await withTenant(tenantId, (tx) =>
      tx.select().from(schema.rawMetaInsights).where(eq(schema.rawMetaInsights.level, 'campaign')),
    );
    expect(rows.length).toBeGreaterThan(0);
    for (const row of rows) {
      expect((row.payload as Record<string, unknown>).attribution_setting).toBe('7d_click_1d_view');
    }
  });

  it('keeps the zero-spend day as a real row', async () => {
    const rows = await withTenant(tenantId, (tx) =>
      tx
        .select()
        .from(schema.rawMetaInsights)
        .where(
          and(
            eq(schema.rawMetaInsights.campaignId, '120210000000000002'),
            eq(schema.rawMetaInsights.date, '2026-02-02'),
          ),
        ),
    );
    expect(rows).toHaveLength(1);
    expect((rows[0]!.payload as Record<string, unknown>).spend).toBe('0.00');
  });

  it('requests unique metrics only inside the 13-month window', () => {
    const recent = {
      start: new Date(Date.now() - 30 * 86_400_000),
      end: new Date(),
    };
    expect(insightsFieldsFor('campaign', recent)).toContain('reach');

    const old = {
      start: new Date('2023-01-01T00:00:00Z'),
      end: new Date('2023-02-01T00:00:00Z'),
    };
    const oldFields = insightsFieldsFor('campaign', old);
    expect(oldFields).not.toContain('reach');
    expect(oldFields).not.toContain('frequency');
    expect(oldFields).toContain('spend');
  });
});

describe('meta restatement', () => {
  it('every incremental re-pulls a trailing 28-day window and updates restated days in place', async () => {
    router.state.restated = true;
    router.state.requests = [];
    const before = await countRawMetaInsights(tenantId);

    await runIncremental(ctx(), metaConnector);

    // Same keys re-served → replaced, not duplicated.
    expect(await countRawMetaInsights(tenantId)).toBe(before);

    const [restated] = await withTenant(tenantId, (tx) =>
      tx
        .select()
        .from(schema.rawMetaInsights)
        .where(
          and(
            eq(schema.rawMetaInsights.campaignId, '120210000000000001'),
            eq(schema.rawMetaInsights.date, '2026-02-03'),
          ),
        ),
    );
    expect((restated!.payload as Record<string, unknown>).spend).toBe('118.75');

    // And the requested window really was ~28 days back from now.
    const insightsCall = router.state.requests.find((u) => u.includes('time_range'));
    const timeRange = JSON.parse(new URL(insightsCall!).searchParams.get('time_range')!) as {
      since: string;
      until: string;
    };
    const spanDays = (Date.parse(timeRange.until) - Date.parse(timeRange.since)) / 86_400_000;
    expect(spanDays).toBeGreaterThanOrEqual(27);
    expect(spanDays).toBeLessThanOrEqual(29);
  });
});

describe('meta health', () => {
  it('reports healthy for an active account and unhealthy otherwise', async () => {
    expect((await metaConnector.health(ctx())).healthy).toBe(true);

    const disabledRouter = (async (input: unknown) => {
      const url = new URL(String(input));
      if (url.pathname.endsWith('/insights')) throw new Error('unexpected');
      return json({ ...fixture('synthetic-account-info.json'), account_status: 2 });
    }) as typeof fetch;
    const result = await metaConnector.health({ ...ctx(), fetchImpl: disabledRouter });
    expect(result.healthy).toBe(false);
    expect(result.detail).toMatch(/status 2/);
  });
});
