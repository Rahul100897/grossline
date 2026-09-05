// pnpm seed:demo — build the fictional demo tenant (18 months, deterministic).
import { loadRootEnv } from '@grossline/core';
import { closeDbPools } from '../src/client';
import { seedDemoTenant } from '../src/seed-demo';

loadRootEnv();

seedDemoTenant()
  .then(async (summary) => {
    console.log('seed:demo complete');
    console.table([summary]);
    await closeDbPools();
  })
  .catch(async (err) => {
    console.error('seed:demo failed:', err instanceof Error ? err.message : err);
    await closeDbPools();
    process.exit(1);
  });
