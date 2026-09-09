// Compute findings for a tenant and month:
//   pnpm findings:compute <tenantId> <YYYY-MM>
import { z } from 'zod';
import { closeDbPools } from '@grossline/db';
import { runFindings } from '../findings/pipeline';

const args = z
  .tuple([z.string().uuid(), z.string().regex(/^\d{4}-\d{2}$/)])
  .safeParse(process.argv.slice(2));
if (!args.success) {
  console.error('Usage: pnpm findings:compute <tenantId> <YYYY-MM>');
  process.exit(1);
}
const [tenantId, month] = args.data;
const period = `${month}-01`;

runFindings(tenantId, period)
  .then(async (result) => {
    console.log(`\nFindings — ${period}`);
    console.log(
      `  fired ${result.fired}, actionable ${result.actionable}, suppressed ${result.suppressed}, resolved ${result.resolved}`,
    );
    if (result.nothingToChange) console.log('  → nothing needs changing this month');
    for (const f of result.ranked) {
      const flag = f.suppressed ? `suppressed (${f.suppressedReason})` : 'surfaced';
      console.log(`  • ${f.ruleId} [${f.entityLabel}] impact=${f.moneyImpactMinor} ${flag}`);
    }
    if (result.skipped.length > 0) {
      console.log('  skipped:');
      for (const s of result.skipped) console.log(`    - ${s.ruleId}: ${s.reason}`);
    }
    await closeDbPools();
  })
  .catch(async (err) => {
    console.error('findings:compute failed:', err instanceof Error ? err.message : err);
    await closeDbPools();
    process.exit(1);
  });
