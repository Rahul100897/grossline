import { resetDemo } from '../src/seed-merchant-demo';
import { closeDbPools } from '../src/client';

resetDemo()
  .then((s) => console.log(`demo:reset complete — ${s.email} restored (tenant ${s.tenantId})`))
  .catch((err) => {
    console.error('demo:reset failed:', err instanceof Error ? err.message : err);
    process.exitCode = 1;
  })
  .finally(closeDbPools);
