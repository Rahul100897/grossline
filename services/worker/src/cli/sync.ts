// Manual sync for one tenant: pnpm worker:sync <tenantId> [backfill|incremental]
import { z } from 'zod';
import { logger } from '@grossline/core';
import { createRedis } from '../redis';
import { enqueueSync } from '../sync';

const args = z
  .tuple([z.string().uuid()])
  .rest(z.enum(['backfill', 'incremental']))
  .safeParse(process.argv.slice(2));

if (!args.success) {
  console.error('Usage: pnpm worker:sync <tenantId> [backfill|incremental]');
  process.exit(1);
}

const [tenantId, kind = 'incremental'] = args.data;
const connection = createRedis();

enqueueSync(connection, { tenantId, kind })
  .then((jobId) => {
    logger.info('sync enqueued', { tenantId, kind, jobId });
    connection.disconnect();
  })
  .catch((err) => {
    logger.error('failed to enqueue sync', {
      tenantId,
      error: err instanceof Error ? err.message : String(err),
    });
    connection.disconnect();
    process.exit(1);
  });
