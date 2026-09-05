// Manual sync for one tenant: pnpm worker:sync <tenantId> [backfill|incremental]
// Enqueues one job per connection the tenant has (a running worker picks them up).
import { z } from 'zod';
import { logger } from '@grossline/core';
import { listConnections } from '@grossline/db';
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

async function main(): Promise<void> {
  const connections = await listConnections(tenantId);
  if (connections.length === 0) {
    logger.warn('tenant has no connections; nothing to sync', { tenantId });
    return;
  }
  for (const conn of connections) {
    const jobId = await enqueueSync(connection, { tenantId, kind, connectionId: conn.id });
    logger.info('sync enqueued', { tenantId, kind, provider: conn.provider, jobId });
  }
}

main()
  .then(() => connection.disconnect())
  .catch((err) => {
    logger.error('failed to enqueue sync', {
      tenantId,
      error: err instanceof Error ? err.message : String(err),
    });
    connection.disconnect();
    process.exit(1);
  });
