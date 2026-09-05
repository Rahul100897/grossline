import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { logger } from '@grossline/core';
import { clearCursors, closeDbPools, createConnection, createTenant, getConnection } from '@grossline/db';
import { backfillProgress, chunkWindow, runBackfill, runIncremental } from '../src/connectors/engine';
import type { Connector, DateWindow, SyncContext } from '../src/connectors/types';

const WINDOW: DateWindow = {
  start: new Date('2026-01-01T00:00:00Z'),
  end: new Date('2026-06-30T00:00:00Z'), // 180 days → 6 chunks of 30
};

/** Deterministic fake provider: one row per stream per day. */
function makeFakeConnector(sink: string[], failAtChunk: { value: number | null }): Connector {
  let chunksDone = 0;
  return {
    provider: 'fake',
    streams: ['events'],
    chunkDays: 30,
    async backfillChunk(_ctx, stream, window) {
      if (failAtChunk.value !== null && chunksDone >= failAtChunk.value) {
        throw new Error('injected interruption');
      }
      let rows = 0;
      for (let t = window.start.getTime(); t < window.end.getTime(); t += 86_400_000) {
        sink.push(`${stream}:${new Date(t).toISOString().slice(0, 10)}`);
        rows++;
      }
      chunksDone++;
      return { rowsWritten: rows };
    },
    async incremental(_ctx, since) {
      sink.push(`incremental-since:${since ?? 'null'}`);
      return { rowsWritten: 1, newSince: '2026-07-01T00:00:00Z' };
    },
    async health() {
      return { healthy: true };
    },
  };
}

let tenantId: string;

function ctxFor(connectionId: string): SyncContext {
  return { tenantId, connectionId, fetchImpl: fetch, log: logger };
}

async function makeConnection(): Promise<string> {
  const conn = await createConnection({
    tenantId,
    provider: 'shopify', // enum placeholder; the engine only needs an id to hang cursors on
    externalAccountId: `fake-${randomUUID().slice(0, 8)}`,
  });
  return conn.id;
}

beforeAll(async () => {
  tenantId = (
    await createTenant({
      name: 'Engine tenant',
      slug: `engine-${randomUUID().slice(0, 8)}`,
      reportingCurrency: 'USD',
      reportingTimezone: 'UTC',
    })
  ).id;
});

afterAll(async () => {
  await closeDbPools();
});

describe('chunkWindow', () => {
  it('slices a window into half-open chunks covering it exactly', () => {
    const chunks = chunkWindow(WINDOW, 30);
    expect(chunks).toHaveLength(6);
    expect(chunks[0]!.start).toEqual(WINDOW.start);
    expect(chunks.at(-1)!.end).toEqual(WINDOW.end);
    for (let i = 1; i < chunks.length; i++) {
      expect(chunks[i]!.start).toEqual(chunks[i - 1]!.end);
    }
  });
});

describe('resumable backfill', () => {
  it('an interrupted backfill resumes from its cursor and produces identical rows', async () => {
    // Uninterrupted reference run.
    const sinkA: string[] = [];
    const connA = await makeConnection();
    const summaryA = await runBackfill(ctxFor(connA), makeFakeConnector(sinkA, { value: null }), WINDOW);
    expect(summaryA.chunksRun).toBe(6);

    // Interrupted run: dies at the start of chunk 4.
    const sinkB: string[] = [];
    const connB = await makeConnection();
    const failAt = { value: 3 as number | null };
    await expect(
      runBackfill(ctxFor(connB), makeFakeConnector(sinkB, failAt), WINDOW),
    ).rejects.toThrow(/injected interruption/);
    expect(sinkB.length).toBeLessThan(sinkA.length);

    // Mid-flight progress is visible and partial.
    const midProgress = await backfillProgress(ctxFor(connB), { streams: ['events'] });
    expect(midProgress.overall).toBeGreaterThan(0.4);
    expect(midProgress.overall).toBeLessThan(0.6);
    const midConn = await getConnection(tenantId, connB);
    expect(midConn!.backfillCompletedAt).toBeNull();

    // Resume: same window, fresh connector instance, no injected failure.
    const summaryB = await runBackfill(ctxFor(connB), makeFakeConnector(sinkB, { value: null }), WINDOW);
    expect(summaryB.chunksSkipped).toBe(3);
    expect(summaryB.chunksRun).toBe(3);
    expect(sinkB).toEqual(sinkA);

    const doneConn = await getConnection(tenantId, connB);
    expect(doneConn!.backfillCompletedAt).not.toBeNull();
    const progress = await backfillProgress(ctxFor(connB), { streams: ['events'] });
    expect(progress.overall).toBe(1);
  });

  it('refuses to resume with a different window than the one in progress', async () => {
    const sink: string[] = [];
    const connId = await makeConnection();
    const failAt = { value: 1 as number | null };
    await expect(runBackfill(ctxFor(connId), makeFakeConnector(sink, failAt), WINDOW)).rejects.toThrow();
    await expect(
      runBackfill(ctxFor(connId), makeFakeConnector(sink, { value: null }), {
        start: new Date('2025-01-01T00:00:00Z'),
        end: new Date('2025-06-30T00:00:00Z'),
      }),
    ).rejects.toThrow(/window differs/);
    await clearCursors(tenantId, connId);
    // After clearing cursors the new window is accepted.
    const summary = await runBackfill(ctxFor(connId), makeFakeConnector([], { value: null }), {
      start: new Date('2025-01-01T00:00:00Z'),
      end: new Date('2025-01-31T00:00:00Z'),
    });
    expect(summary.chunksRun).toBe(1);
  });
});

describe('incremental', () => {
  it('passes the stored watermark to the connector and advances it', async () => {
    const sink: string[] = [];
    const connId = await makeConnection();
    const connector = makeFakeConnector(sink, { value: null });
    await runIncremental(ctxFor(connId), connector);
    await runIncremental(ctxFor(connId), connector);
    expect(sink).toEqual([
      'incremental-since:null',
      'incremental-since:2026-07-01T00:00:00Z',
    ]);
  });
});
