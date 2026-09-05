import { randomUUID } from 'node:crypto';
import { eq } from 'drizzle-orm';
import { QueueEvents, Worker } from 'bullmq';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { closeDbPools, createTenant, schema, withTenant } from '@grossline/db';
import { createRedis, queuePrefix } from '../src/redis';
import {
  SYNC_ATTEMPTS,
  createSyncWorker,
  enqueueSync,
  getDeadLetterQueue,
  getSyncQueue,
  syncQueueName,
} from '../src/sync';

process.env.SYNC_BACKOFF_MS = '5'; // fast retries in tests

const connection = createRedis();
let tenantId: string;
let worker: Worker;

beforeAll(async () => {
  const dlq = getDeadLetterQueue(connection);
  await dlq.obliterate({ force: true }).catch(() => {});
  await dlq.close();

  tenantId = (
    await createTenant({
      name: 'Job Runner Tenant',
      slug: `jobs-${randomUUID().slice(0, 8)}`,
      reportingCurrency: 'USD',
      reportingTimezone: 'UTC',
    })
  ).id;
  worker = createSyncWorker(connection, tenantId);
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

    // Wait until the dead-letter queue has received the job.
    const dlq = getDeadLetterQueue(connection);
    await vi.waitFor(
      async () => {
        const counts = await dlq.getJobCounts('waiting', 'active', 'completed', 'delayed');
        expect(counts.waiting + counts.active + counts.completed + counts.delayed).toBe(1);
      },
      { timeout: 20_000, interval: 100 },
    );

    const [dead] = await dlq.getJobs(['waiting', 'active', 'completed', 'delayed']);
    expect(dead!.data.queue).toBe(syncQueueName(tenantId));
    expect(dead!.data.failedReason).toMatch(/simulated failure/);
    await dlq.close();

    // The original job failed after exactly SYNC_ATTEMPTS attempts.
    const queue = getSyncQueue(connection, tenantId);
    const [failedJob] = await queue.getJobs(['failed']);
    expect(failedJob!.attemptsMade).toBe(SYNC_ATTEMPTS);
    await queue.close();

    // And the sync_runs row records the failure.
    await vi.waitFor(
      async () => {
        const runs = await withTenant(tenantId, (tx) =>
          tx
            .select()
            .from(schema.syncRuns)
            .where(eq(schema.syncRuns.status, 'failed')),
        );
        expect(runs).toHaveLength(1);
        expect(runs[0]!.error).toMatch(/simulated failure/);
        expect(runs[0]!.finishedAt).not.toBeNull();
      },
      { timeout: 10_000, interval: 100 },
    );
  });

  it('a successful job records a success sync_run with duration', async () => {
    const events = new QueueEvents(syncQueueName(tenantId), {
      connection: connection.duplicate({ maxRetriesPerRequest: null }),
      prefix: queuePrefix(),
    });
    await events.waitUntilReady();
    const jobId = await enqueueSync(connection, { tenantId, kind: 'backfill' });
    const queue = getSyncQueue(connection, tenantId);
    const job = await queue.getJob(jobId);
    await job!.waitUntilFinished(events);
    await queue.close();
    await events.close();

    const runs = await withTenant(tenantId, (tx) =>
      tx
        .select()
        .from(schema.syncRuns)
        .where(eq(schema.syncRuns.status, 'success')),
    );
    expect(runs).toHaveLength(1);
    expect(runs[0]!.kind).toBe('backfill');
    expect(runs[0]!.durationMs).not.toBeNull();
    expect(runs[0]!.finishedAt).not.toBeNull();
  });
});
