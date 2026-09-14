import { seedDemoMerchant } from '../src/seed-merchant-demo';
import { closeDbPools } from '../src/client';

seedDemoMerchant()
  .then((s) => {
    console.log(`seed:demo-portal complete — ${s.email} / ${s.password} (tenant ${s.tenantId})`);
  })
  .catch((err) => {
    console.error('seed:demo-portal failed:', err instanceof Error ? err.message : err);
    process.exitCode = 1;
  })
  .finally(closeDbPools);
