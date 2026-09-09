// Calibrate a tenant's finding thresholds from its own history:
//   pnpm findings:calibrate <tenantId> [monthsBack] [--force]
import { z } from 'zod';
import { closeDbPools } from '@grossline/db';
import { calibrateTenant } from '../findings/calibrate';

const raw = process.argv.slice(2);
const force = raw.includes('--force');
const args = z
  .tuple([z.string().uuid()])
  .rest(z.string())
  .safeParse(raw.filter((a) => a !== '--force'));

if (!args.success) {
  console.error('Usage: pnpm findings:calibrate <tenantId> [monthsBack] [--force]');
  process.exit(1);
}
const [tenantId, monthsBackArg] = args.data;
const monthsBack = monthsBackArg ? Number(monthsBackArg) : undefined;

calibrateTenant(tenantId, { monthsBack, force })
  .then(async ({ thresholds, stored }) => {
    console.log(stored ? 'calibrated and stored:' : 'kept existing (analyst-edited):');
    console.table(thresholds);
    await closeDbPools();
  })
  .catch(async (err) => {
    console.error('calibrate failed:', err instanceof Error ? err.message : err);
    await closeDbPools();
    process.exit(1);
  });
