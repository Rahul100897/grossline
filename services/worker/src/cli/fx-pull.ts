// Pull daily FX rates: pnpm fx:pull [daysBack]
// Defaults to the trailing 90 days for the currencies currently in use.
import { closeDbPools } from '@grossline/db';
import { fetchAndStoreFxRates } from '../fx';

const daysBack = Number(process.argv[2] ?? 90);
if (!Number.isInteger(daysBack) || daysBack < 1 || daysBack > 4000) {
  console.error('Usage: pnpm fx:pull [daysBack 1-4000]');
  process.exit(1);
}

const end = new Date().toISOString().slice(0, 10);
const start = new Date(Date.now() - daysBack * 86_400_000).toISOString().slice(0, 10);

fetchAndStoreFxRates({ start, end })
  .then(async (rows) => {
    console.log(`fx:pull stored ${rows} rate rows (${start}..${end})`);
    await closeDbPools();
  })
  .catch(async (err) => {
    console.error('fx:pull failed:', err instanceof Error ? err.message : err);
    await closeDbPools();
    process.exit(1);
  });
