import { Queue, Worker, type Job, type JobsOptions } from 'bullmq';
import type IORedis from 'ioredis';
import { eq } from 'drizzle-orm';
import { z } from 'zod';
import { logger } from '@grossline/core';
import { getConnection, schema, updateConnectionHealth, withTenant } from '@grossline/db';
import { queuePrefix } from './redis';
import { getConnector } from './connectors/registry';
import { runBackfill, runIncremental } from './connectors/engine';
import type { SyncContext } from './connectors/types';

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

// One queue for every tenant — the tenant travels on the job, so a tenant
// created a second ago can sync without any worker restart (docs/decisions.md).
export const SYNC_QUEUE = 'sync';
export const DEAD_LETTER_QUEUE = 'dead-letter';
export const SYNC_ATTEMPTS = 3;

export function defaultJobOptions(): JobsOptions {
  return {
    attempts: SYNC_ATTEMPTS,
    backoff: {
      type: 'exponential',
      delay: Number(process.env.SYNC_BACKOFF_MS ?? 30_000),
    },
    removeOnComplete: { count: 1000 },
    removeOnFail: false,
  };
}

export function getSyncQueue(connection: IORedis): Queue<SyncJobData> {
  return new Queue<SyncJobData>(SYNC_QUEUE, {
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
  const queue = getSyncQueue(connection);
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

async function processConnectorJob(data: SyncJobData): Promise<number> {
  const connection = await getConnection(data.tenantId, data.connectionId!);
  if (!connection) throw new Error(`connection ${data.connectionId} not found for tenant`);
  const connector = getConnector(connection.provider);
  const ctx: SyncContext = {
    tenantId: data.tenantId,
    connectionId: connection.id,
    fetchImpl: fetch,
    log: logger,
  };
  if (data.kind === 'backfill') {
    if (!data.windowStart || !data.windowEnd) {
      throw new Error('backfill jobs need windowStart and windowEnd');
    }
    const summary = await runBackfill(ctx, connector, {
      start: new Date(data.windowStart),
      end: new Date(data.windowEnd),
    });
    return summary.rowsWritten;
  }
  const result = await runIncremental(ctx, connector);
  return result.rowsWritten;
}

/**
 * The single sync worker. Phase 1 connectors are dispatched by provider via
 * the registry; a job without a connectionId is a recorded no-op (kept for
 * the Phase 0 retry/dead-letter proofs).
 */
export function createSyncWorker(connection: IORedis): Worker<SyncJobData> {
  const deadLetter = getDeadLetterQueue(connection);

  const worker = new Worker<SyncJobData>(
    SYNC_QUEUE,
    async (job) => {
      const started = Date.now();
      const syncRunId = await ensureSyncRun(job);
      const data = syncJobSchema.parse(job.data);
      if (data.simulateFailure) {
        throw new Error('simulated failure (requested by job data)');
      }
      const rowsWritten = data.connectionId ? await processConnectorJob(data) : 0;
      await finishSyncRun(data.tenantId, syncRunId, {
        status: 'success',
        rowsWritten,
        durationMs: Date.now() - started,
      });
      if (data.connectionId) {
        await updateConnectionHealth(data.tenantId, data.connectionId, {
          health: 'healthy',
          lastError: null,
          lastSuccessAt: new Date(),
        });
      }
    },
    { connection, prefix: queuePrefix(), concurrency: 2 },
  );

  worker.on('failed', (job, err) => {
    if (!job) return;
    const attempts = job.opts.attempts ?? 1;
    const isFinal = job.attemptsMade >= attempts;
    logger.warn('sync job attempt failed', {
      jobId: job.id,
      tenantId: job.data.tenantId,
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
      if (data.connectionId) {
        await updateConnectionHealth(data.tenantId, data.connectionId, {
          health: 'degraded',
          lastError: err.message,
        });
      }
      await deadLetter.add('dead', {
        queue: SYNC_QUEUE,
        jobId: job.id,
        data,
        failedReason: err.message,
        failedAt: new Date().toISOString(),
      });
    })().catch((e: unknown) => {
      logger.error('dead-letter handling failed', {
        jobId: job.id,
        error: e instanceof Error ? e.message : String(e),
      });
    });
  });

  return worker;
}
