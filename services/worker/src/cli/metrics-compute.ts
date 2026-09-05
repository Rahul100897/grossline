// Compute every metric for one tenant and one reporting month:
//   pnpm metrics:compute <tenantId> <YYYY-MM>
import { z } from 'zod';
import { closeDbPools } from '@grossline/db';
import { computeMetricsForMonth } from '../metrics/pipeline';

const args = z
  .tuple([z.string().uuid(), z.string().regex(/^\d{4}-\d{2}$/)])
  .safeParse(process.argv.slice(2));
if (!args.success) {
  console.error('Usage: pnpm metrics:compute <tenantId> <YYYY-MM>');
  process.exit(1);
}
const [tenantId, period] = args.data;
const [year, month] = period.split('-').map(Number) as [number, number];

computeMetricsForMonth(tenantId, year, month)
  .then(async ({ metricsWritten }) => {
    console.log(`computed ${metricsWritten} metric value(s) for ${period}`);
    await closeDbPools();
  })
  .catch(async (err) => {
    console.error('metrics:compute failed:', err instanceof Error ? err.message : err);
    await closeDbPools();
    process.exit(1);
  });
