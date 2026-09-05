import { Queue, Worker, type Job, type JobsOptions } from 'bullmq';
import type IORedis from 'ioredis';
import { eq } from 'drizzle-orm';
import { z } from 'zod';
import { logger } from '@grossline/core';
import { schema, withTenant } from '@grossline/db';
import { queuePrefix } from './redis';

export const syncJobSchema = z.object({
  tenantId: z.string().uuid(),
  kind: z.enum(['backfill', 'incremental']),
  connectionId: z.string().uuid().optional(),
  windowStart: z.string().datetime().optional(),
  windowEnd: z.string().datetime().optional(),
  /** Test hook: makes the job throw so retry/dead-letter paths can be proven. */
  simulateFailure: z.boolean().optional(),
  /** Set by the processor on the first attempt so retries reuse one run row. */
  syncRunId: z.string().uuid().optional(),
});

export type SyncJobData = z.infer<typeof syncJobSchema>;

export const DEAD_LETTER_QUEUE = 'dead-letter';
export const SYNC_ATTEMPTS = 3;

export function syncQueueName(tenantId: string): string {
  // BullMQ forbids ':' inside queue names (it is the Redis key separator).
  return `sync-${tenantId}`;
}

export function defaultJobOptions(): JobsOptions {
  return {
    attempts: SYNC_ATTEMPTS,
    backoff: {
      type: 'exponential',
      delay: Number(process.env.SYNC_BACKOFF_MS ?? 30_000),
    },
    removeOnComplete: { count: 100 },
    removeOnFail: false,
  };
}

export function getSyncQueue(connection: IORedis, tenantId: string): Queue<SyncJobData> {
  return new Queue<SyncJobData>(syncQueueName(tenantId), {
    connection,
    prefix: queuePrefix(),
    defaultJobOptions: defaultJobOptions(),
  });
}

export function getDeadLetterQueue(connection: IORedis): Queue {
  return new Queue(DEAD_LETTER_QUEUE, { connection, prefix: queuePrefix() });
}

export async function enqueueSync(
  connection: IORedis,
  data: Omit<SyncJobData, 'syncRunId'>,
): Promise<string> {
  const parsed = syncJobSchema.parse(data);
  const queue = new Queue<SyncJobData>(syncQueueName(parsed.tenantId), {
    connection,
    prefix: queuePrefix(),
  });
  try {
    const job = await queue.add(`sync-${parsed.kind}`, parsed, defaultJobOptions());
    return job.id ?? 'unknown';
  } finally {
    await queue.close();
  }
}

async function ensureSyncRun(job: Job<SyncJobData>): Promise<string> {
  const data = syncJobSchema.parse(job.data);
  if (data.syncRunId) return data.syncRunId;
  const [row] = await withTenant(data.tenantId, (tx) =>
    tx
      .insert(schema.syncRuns)
      .values({
        tenantId: data.tenantId,
        connectionId: data.connectionId ?? null,
        kind: data.kind,
        windowStart: data.windowStart ? new Date(data.windowStart) : null,
        windowEnd: data.windowEnd ? new Date(data.windowEnd) : null,
        status: 'running',
      })
      .returning({ id: schema.syncRuns.id }),
  );
  if (!row) throw new Error('sync_runs insert returned no row');
  await job.updateData({ ...data, syncRunId: row.id });
  return row.id;
}

async function finishSyncRun(
  tenantId: string,
  syncRunId: string,
  patch: { status: 'success' | 'failed'; rowsWritten?: number; durationMs?: number; error?: string },
): Promise<void> {
  await withTenant(tenantId, (tx) =>
    tx
      .update(schema.syncRuns)
      .set({
        status: patch.status,
        rowsWritten: patch.rowsWritten ?? 0,
        durationMs: patch.durationMs ?? null,
        error: patch.error ?? null,
        finishedAt: new Date(),
      })
      .where(eq(schema.syncRuns.id, syncRunId)),
  );
}

/**
 * Worker for one tenant's sync queue. Phase 0 has no connectors, so a
 * successful run is a recorded no-op; the machinery (retries, dead-letter,
 * sync_runs bookkeeping) is the deliverable.
 */
export function createSyncWorker(connection: IORedis, tenantId: string): Worker<SyncJobData> {
  const deadLetter = getDeadLetterQueue(connection);

  const worker = new Worker<SyncJobData>(
    syncQueueName(tenantId),
    async (job) => {
      const started = Date.now();
      const syncRunId = await ensureSyncRun(job);
      const data = syncJobSchema.parse(job.data);
      if (data.simulateFailure) {
        throw new Error('simulated failure (requested by job data)');
      }
      // Connector work goes here from Phase 1.
      await finishSyncRun(data.tenantId, syncRunId, {
        status: 'success',
        durationMs: Date.now() - started,
      });
    },
    { connection, prefix: queuePrefix(), concurrency: 1 },
  );

  worker.on('failed', (job, err) => {
    if (!job) return;
    const attempts = job.opts.attempts ?? 1;
    const isFinal = job.attemptsMade >= attempts;
    logger.warn('sync job attempt failed', {
      tenantId,
      jobId: job.id,
      attempt: job.attemptsMade,
      of: attempts,
      final: isFinal,
      error: err.message,
    });
    if (!isFinal) return;
    void (async () => {
      const data = syncJobSchema.parse(job.data);
      if (data.syncRunId) {
        await finishSyncRun(data.tenantId, data.syncRunId, {
          status: 'failed',
          error: err.message,
        });
      }
      await deadLetter.add('dead', {
        queue: syncQueueName(tenantId),
        jobId: job.id,
        data,
        failedReason: err.message,
        failedAt: new Date().toISOString(),
      });
    })().catch((e: unknown) => {
      logger.error('dead-letter handling failed', {
        tenantId,
        jobId: job.id,
        error: e instanceof Error ? e.message : String(e),
      });
    });
  });

  return worker;
}
