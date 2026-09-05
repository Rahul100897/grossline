// Cost coverage for a tenant and month: what share of order lines can be
// costed, and the revenue at stake where they cannot. Missing is missing —
// never zero (docs/metrics.md).
//
//   pnpm costs:coverage <tenantId> <YYYY-MM>
import { z } from 'zod';
import { computeCostCoverage, minorUnitExponent, monthWindow } from '@grossline/core';
import { closeDbPools, getTenant, listCostableOrderLines, listProductCosts } from '@grossline/db';

const args = z
  .tuple([z.string().uuid(), z.string().regex(/^\d{4}-\d{2}$/)])
  .safeParse(process.argv.slice(2));
if (!args.success) {
  console.error('Usage: pnpm costs:coverage <tenantId> <YYYY-MM>');
  process.exit(1);
}
const [tenantId, period] = args.data;

const fmt = (minor: number, currency: string): string =>
  `${(minor / 10 ** minorUnitExponent(currency)).toFixed(minorUnitExponent(currency))} ${currency}`;

async function main(): Promise<void> {
  const tenant = await getTenant(tenantId);
  if (!tenant) throw new Error('tenant not found');
  const [year, month] = period!.split('-').map(Number);
  const window = monthWindow(tenant.reportingTimezone, year!, month!);

  const [lines, costs] = await Promise.all([
    listCostableOrderLines(tenantId, { start: window.startUtc, end: window.endUtc }),
    listProductCosts(tenantId),
  ]);
  const coverage = computeCostCoverage(lines, costs);
  const currency = lines[0]?.currency ?? tenant.reportingCurrency;

  console.log(`cost coverage — ${tenant.name}, ${period} (${tenant.reportingTimezone})`);
  console.log(
    `  lines: ${coverage.costedLines}/${coverage.totalLines} costed (${(coverage.coverageRate * 100).toFixed(1)}%)`,
  );
  const p = coverage.provenance;
  console.log(
    `  provenance: ${p.uploadLines} from merchant upload, ${p.shopifyDatedLines} shopify (dated), ` +
      `${p.shopifyEpochAssumedLines} shopify (EPOCH-ASSUMED — applied to all history without a real date)`,
  );
  console.log(`  revenue at stake: ${fmt(coverage.revenueAtStakeMinor, currency)} of ${fmt(coverage.totalRevenueMinor, currency)}`);
  if (coverage.missing.length > 0) {
    console.log(`  missing costs (${coverage.missing.length} sku/variant key(s)):`);
    for (const m of coverage.missing) {
      console.log(
        `    sku=${m.sku ?? '—'} variant=${m.variantId ?? '—'} lines=${m.lines} units=${m.units} at stake=${fmt(m.revenueAtStakeMinor, currency)}`,
      );
    }
    process.exitCode = 1; // visible in cron/CI contexts
  } else {
    console.log('  no missing costs in this window');
  }
}

main()
  .then(() => closeDbPools())
  .catch(async (err) => {
    console.error('costs:coverage failed:', err instanceof Error ? err.message : err);
    await closeDbPools();
    process.exit(1);
  });
