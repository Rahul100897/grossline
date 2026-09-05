import { Queue, Worker } from 'bullmq';
import type IORedis from 'ioredis';
import { logger } from '@grossline/core';
import { listActiveTenants, listConnections } from '@grossline/db';
import { queuePrefix } from './redis';
import { enqueueSync } from './sync';
import { pullRecentFxRates } from './fx';

export const SCHEDULER_QUEUE = 'scheduler';
/** 02:00 UTC nightly — before any merchant's business morning. */
const NIGHTLY_CRON = '0 2 * * *';

/**
 * Registers the repeatable nightly job and returns a worker that fans out one
 * incremental sync per connection of every active tenant when it fires.
 */
export async function startScheduler(connection: IORedis): Promise<Worker> {
  const queue = new Queue(SCHEDULER_QUEUE, { connection, prefix: queuePrefix() });
  await queue.upsertJobScheduler('nightly-sync', { pattern: NIGHTLY_CRON });
  await queue.close();

  return new Worker(
    SCHEDULER_QUEUE,
    async () => {
      const tenants = await listActiveTenants();
      let enqueued = 0;
      for (const tenant of tenants) {
        const connections = await listConnections(tenant.id);
        for (const conn of connections) {
          await enqueueSync(connection, {
            tenantId: tenant.id,
            kind: 'incremental',
            connectionId: conn.id,
          });
          enqueued++;
        }
      }
      logger.info('nightly scheduler fired', { activeTenants: tenants.length, enqueued });
      try {
        await pullRecentFxRates();
      } catch (err) {
        // FX is reference data; a failed pull must not block tenant syncs.
        logger.error('nightly fx pull failed', {
          error: err instanceof Error ? err.message : String(err),
        });
      }
    },
    { connection, prefix: queuePrefix() },
  );
}
