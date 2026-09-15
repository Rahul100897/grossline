// One-shot demo provisioner — safe to run against any database (local or a fresh
// production one) via DATABASE_URL. Builds ONLY synthetic demo data: it never
// touches a real store or any platform credentials.
//
//   pnpm --filter @grossline/worker demo:provision
//
// Sequence:
//   1. seed the demo-brand tenant + ~18 months of raw orders/ads (idempotent)
//   2. recompute the metric layer for that range, so every portal page has figures
//   3. seed the demo merchant login (demo@getgrossline.com)
//
// It does not build reports; the portal's Reports archive shows its empty state
// until reports are built and marked sent (a separate, gated step).
import { seedDemoTenant, seedDemoMerchant, getTenantBySlug, closeDbPools } from '@grossline/db';
import { recomputeMetricsRange } from '../metrics/pipeline';

function monthsBack(n: number): string {
  const d = new Date();
  d.setUTCMonth(d.getUTCMonth() - n);
  return d.toISOString().slice(0, 7);
}

async function main(): Promise<void> {
  const summary = await seedDemoTenant();
  const tenant = await getTenantBySlug('demo-brand');
  if (!tenant) throw new Error('demo tenant not found after seeding');

  // Recompute through the last COMPLETE month, not the current partial one — the
  // portal's landing page shows the latest month that has metrics, and a client
  // should land on full figures, not a half-elapsed month.
  const from = monthsBack(summary.months + 1);
  const to = monthsBack(1);
  const { months, metricsWritten } = await recomputeMetricsRange(tenant.id, from, to);

  const merchant = await seedDemoMerchant();

  console.log('demo:provision complete');
  console.log(`  tenant     ${tenant.id} (demo-brand)`);
  console.log(`  raw data   ${summary.orders} orders, ${summary.months} months`);
  console.log(`  metrics    ${metricsWritten} values across ${months} months`);
  console.log(`  login      ${merchant.email} / ${merchant.password}`);
}

main()
  .catch((err) => {
    console.error('demo:provision failed:', err instanceof Error ? err.message : err);
    process.exitCode = 1;
  })
  .finally(closeDbPools);
