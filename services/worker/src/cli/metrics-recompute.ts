// Recompute a month range (inclusive), e.g. after a definition change:
//   pnpm metrics:recompute <tenantId> <fromYYYY-MM> [toYYYY-MM]
// Defaults `to` to the current month in UTC.
import { z } from 'zod';
import { closeDbPools } from '@grossline/db';
import { recomputeMetricsRange } from '../metrics/pipeline';

const monthArg = z.string().regex(/^\d{4}-\d{2}$/);
const args = z
  .tuple([z.string().uuid(), monthArg])
  .rest(monthArg)
  .safeParse(process.argv.slice(2));
if (!args.success) {
  console.error('Usage: pnpm metrics:recompute <tenantId> <fromYYYY-MM> [toYYYY-MM]');
  process.exit(1);
}
const [tenantId, from, to = new Date().toISOString().slice(0, 7)] = args.data;

recomputeMetricsRange(tenantId, from, to)
  .then(async ({ months, metricsWritten }) => {
    console.log(`recomputed ${months} month(s), ${metricsWritten} metric value(s)`);
    await closeDbPools();
  })
  .catch(async (err) => {
    console.error('metrics:recompute failed:', err instanceof Error ? err.message : err);
    await closeDbPools();
    process.exit(1);
  });
