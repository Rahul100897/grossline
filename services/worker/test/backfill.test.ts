import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { PROVIDER_STREAMS } from '@grossline/core';
import {
  closeDbPools,
  createConnection,
  createTenant,
  getBackfillProgress,
  getConnection,
  resetBackfill,
  setCursor,
} from '@grossline/db';
import { BACKFILL_MONTHS, backfillWindowFor } from '../src/backfill';
import { shopifyConnector } from '../src/connectors/shopify/connector';
import { metaConnector } from '../src/connectors/meta/connector';
import { googleAdsConnector } from '../src/connectors/google-ads/connector';

let tenantId: string;
let connectionId: string;

beforeAll(async () => {
  tenantId = (
    await createTenant({
      name: 'Backfill tenant',
      slug: `backfill-${randomUUID().slice(0, 8)}`,
      reportingCurrency: 'USD',
      reportingTimezone: 'UTC',
    })
  ).id;
  connectionId = (
    await createConnection({
      tenantId,
      provider: 'shopify',
      externalAccountId: `backfill-${randomUUID().slice(0, 8)}`,
    })
  ).id;
});

afterAll(async () => {
  await closeDbPools();
});

describe('backfillWindowFor', () => {
  it('gives each provider its documented window, ending tomorrow UTC', () => {
    const now = new Date('2026-09-05T13:00:00Z');
    const shopify = backfillWindowFor('shopify', now);
    expect(shopify.end.toISOString()).toBe('2026-09-06T00:00:00.000Z');
    expect(shopify.start.toISOString()).toBe('2025-08-06T00:00:00.000Z'); // 13 months

    const meta = backfillWindowFor('meta', now);
    expect(meta.start.toISOString()).toBe('2023-08-06T00:00:00.000Z'); // 37 months

    expect(BACKFILL_MONTHS.google_ads).toBe(37);
    expect(BACKFILL_MONTHS.shopify).toBe(13);
  });
});

describe('PROVIDER_STREAMS stays in lockstep with the connectors', () => {
  it('matches each registered connector', () => {
    expect(PROVIDER_STREAMS.shopify).toEqual(shopifyConnector.streams);
    expect(PROVIDER_STREAMS.meta).toEqual(metaConnector.streams);
    expect(PROVIDER_STREAMS.google_ads).toEqual(googleAdsConnector.streams);
  });
});

describe('getBackfillProgress', () => {
  it('reports not-started, partial and complete states', async () => {
    const streams = ['events'];
    const none = await getBackfillProgress(tenantId, connectionId, streams);
    expect(none).toMatchObject({ overall: 0, windowStart: null });

    await setCursor(tenantId, connectionId, 'backfill', {
      windowStart: '2026-01-01T00:00:00.000Z',
      windowEnd: '2026-01-31T00:00:00.000Z',
      startedAt: new Date().toISOString(),
    });
    await setCursor(tenantId, connectionId, 'backfill:events', {
      completedThrough: '2026-01-16T00:00:00.000Z', // exactly half of 30 days
    });
    const half = await getBackfillProgress(tenantId, connectionId, streams);
    expect(half.overall).toBeCloseTo(0.5, 5);
    expect(half.byStream.events).toBeCloseTo(0.5, 5);
    expect(half.windowStart).toBe('2026-01-01T00:00:00.000Z');

    await setCursor(tenantId, connectionId, 'backfill:events', {
      completedThrough: '2026-01-31T00:00:00.000Z',
    });
    const done = await getBackfillProgress(tenantId, connectionId, streams);
    expect(done.overall).toBe(1);
  });

  it('resetBackfill clears cursors and the completion flag', async () => {
    await resetBackfill(tenantId, connectionId);
    const cleared = await getBackfillProgress(tenantId, connectionId, ['events']);
    expect(cleared).toMatchObject({ overall: 0, windowStart: null });
    const connection = await getConnection(tenantId, connectionId);
    expect(connection!.backfillCompletedAt).toBeNull();
  });
});
