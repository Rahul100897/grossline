// Worker entrypoint: one sync worker per tenant queue, plus the nightly
// scheduler. Tenants added while the worker is running are picked up on the
// next restart (documented limitation for Phase 0).
import { logger } from '@grossline/core';
import { listTenants } from '@grossline/db';
import { createRedis } from './redis';
import { startScheduler } from './scheduler';
import { createSyncWorker } from './sync';

async function main(): Promise<void> {
  const connection = createRedis();
  const tenants = await listTenants();
  const workers = tenants.map((t) => createSyncWorker(connection, t.id));
  const scheduler = await startScheduler(connection);
  logger.info('worker started', { tenantQueues: workers.length });

  const shutdown = async () => {
    logger.info('worker shutting down');
    await Promise.all([...workers.map((w) => w.close()), scheduler.close()]);
    connection.disconnect();
    process.exit(0);
  };
  process.on('SIGINT', () => void shutdown());
  process.on('SIGTERM', () => void shutdown());
}

main().catch((err) => {
  logger.error('worker failed to start', {
    error: err instanceof Error ? err.message : String(err),
  });
  process.exit(1);
});
