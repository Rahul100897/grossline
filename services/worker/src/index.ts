// Worker entrypoint: one shared sync worker (any tenant, no restart needed
// when tenants are added) plus the nightly scheduler.
import { logger } from '@grossline/core';
import { createRedis } from './redis';
import { startScheduler } from './scheduler';
import { createSyncWorker } from './sync';
import { registerBuiltinConnectors } from './connectors';

async function main(): Promise<void> {
  const connection = createRedis();
  registerBuiltinConnectors();
  const worker = createSyncWorker(connection);
  const scheduler = await startScheduler(connection);
  logger.info('worker started', { queues: ['sync', 'scheduler'] });

  const shutdown = async () => {
    logger.info('worker shutting down');
    await Promise.all([worker.close(), scheduler.close()]);
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
