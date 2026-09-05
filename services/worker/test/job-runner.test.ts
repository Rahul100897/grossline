import { randomUUID } from 'node:crypto';
import { eq } from 'drizzle-orm';
import { QueueEvents, Worker } from 'bullmq';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { closeDbPools, createTenant, schema, withTenant } from '@grossline/db';
import { createRedis, queuePrefix } from '../src/redis';
import {
  SYNC_ATTEMPTS,
  SYNC_QUEUE,
  createSyncWorker,
  enqueueSync,
  getDeadLetterQueue,
  getSyncQueue,
} from '../src/sync';

process.env.SYNC_BACKOFF_MS = '5'; // fast retries in tests

const connection = createRedis();
let tenantId: string;
let worker: Worker;

async function makeTenant(prefix: string): Promise<string> {
  return (
    await createTenant({
      name: `${prefix} tenant`,
      slug: `${prefix}-${randomUUID().slice(0, 8)}`,
      reportingCurrency: 'USD',
      reportingTimezone: 'UTC',
    })
  ).id;
}

beforeAll(async () => {
  for (const queue of [getDeadLetterQueue(connection), getSyncQueue(connection)]) {
    await queue.obliterate({ force: true }).catch(() => {});
    await queue.close();
  }
  tenantId = await makeTenant('jobs');
  worker = createSyncWorker(connection);
});

afterAll(async () => {
  await worker.close();
  await closeDbPools();
  connection.disconnect();
});

describe('job runner', () => {
  it('a failing job retries three times, dead-letters, and records a failed sync_run', async () => {
    await enqueueSync(connection, {
      tenantId,
      kind: 'incremental',
      simulateFailure: true,
    });

    const dlq = getDeadLetterQueue(connection);
    await vi.waitFor(
      async () => {
        const counts = await dlq.getJobCounts('waiting', 'active', 'completed', 'delayed');
        const total =
          (counts.waiting ?? 0) + (counts.active ?? 0) + (counts.completed ?? 0) + (counts.delayed ?? 0);
        expect(total).toBe(1);
      },
      { timeout: 20_000, interval: 100 },
    );

    const [dead] = await dlq.getJobs(['waiting', 'active', 'completed', 'delayed']);
    expect(dead!.data.queue).toBe(SYNC_QUEUE);
    expect(dead!.data.failedReason).toMatch(/simulated failure/);
    await dlq.close();

    const queue = getSyncQueue(connection);
    const [failedJob] = await queue.getJobs(['failed']);
    expect(failedJob!.attemptsMade).toBe(SYNC_ATTEMPTS);
    await queue.close();

    await vi.waitFor(
      async () => {
        const runs = await withTenant(tenantId, (tx) =>
          tx.select().from(schema.syncRuns).where(eq(schema.syncRuns.status, 'failed')),
        );
        expect(runs).toHaveLength(1);
        expect(runs[0]!.error).toMatch(/simulated failure/);
        expect(runs[0]!.finishedAt).not.toBeNull();
      },
      { timeout: 10_000, interval: 100 },
    );
  });

  it('a successful job records a success sync_run with duration', async () => {
    const events = new QueueEvents(SYNC_QUEUE, {
      connection: connection.duplicate({ maxRetriesPerRequest: null }),
      prefix: queuePrefix(),
    });
    await events.waitUntilReady();
    const jobId = await enqueueSync(connection, { tenantId, kind: 'backfill' });
    const queue = getSyncQueue(connection);
    const job = await queue.getJob(jobId);
    await job!.waitUntilFinished(events);
    await queue.close();
    await events.close();

    const runs = await withTenant(tenantId, (tx) =>
      tx.select().from(schema.syncRuns).where(eq(schema.syncRuns.status, 'success')),
    );
    expect(runs).toHaveLength(1);
    expect(runs[0]!.kind).toBe('backfill');
    expect(runs[0]!.durationMs).not.toBeNull();
  });

  it('a tenant created after the worker started syncs with no restart', async () => {
    // The worker from beforeAll is already running; this tenant did not exist then.
    const lateTenant = await makeTenant('late');

    const events = new QueueEvents(SYNC_QUEUE, {
      connection: connection.duplicate({ maxRetriesPerRequest: null }),
      prefix: queuePrefix(),
    });
    await events.waitUntilReady();
    const jobId = await enqueueSync(connection, { tenantId: lateTenant, kind: 'incremental' });
    const queue = getSyncQueue(connection);
    const job = await queue.getJob(jobId);
    await job!.waitUntilFinished(events);
    await queue.close();
    await events.close();

    const runs = await withTenant(lateTenant, (tx) =>
      tx.select().from(schema.syncRuns).where(eq(schema.syncRuns.status, 'success')),
    );
    expect(runs).toHaveLength(1);
  });
});
