import { Queue, Worker } from 'bullmq';
import type IORedis from 'ioredis';
import { logger } from '@grossline/core';
import { listActiveTenants } from '@grossline/db';
import { queuePrefix } from './redis';
import { enqueueSync } from './sync';

export const SCHEDULER_QUEUE = 'scheduler';
/** 02:00 UTC nightly — before any merchant's business morning. */
const NIGHTLY_CRON = '0 2 * * *';

/**
 * Registers the repeatable nightly job and returns a worker that fans out one
 * incremental sync per active tenant when it fires.
 */
export async function startScheduler(connection: IORedis): Promise<Worker> {
  const queue = new Queue(SCHEDULER_QUEUE, { connection, prefix: queuePrefix() });
  await queue.upsertJobScheduler('nightly-sync', { pattern: NIGHTLY_CRON });
  await queue.close();

  return new Worker(
    SCHEDULER_QUEUE,
    async () => {
      const tenants = await listActiveTenants();
      logger.info('nightly scheduler firing', { activeTenants: tenants.length });
      for (const tenant of tenants) {
        await enqueueSync(connection, { tenantId: tenant.id, kind: 'incremental' });
      }
    },
    { connection, prefix: queuePrefix() },
  );
}
