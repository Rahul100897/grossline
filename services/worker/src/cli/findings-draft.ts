// Generate commentary drafts for a tenant's month:
//   pnpm findings:draft <tenantId> <YYYY-MM>
// Uses the Anthropic API when ANTHROPIC_API_KEY is set (output is guarded so it
// can introduce no figure absent from the record); falls back to the
// deterministic template otherwise.
import { z } from 'zod';
import { closeDbPools } from '@grossline/db';
import { generateDraftsForPeriod } from '../findings/commentary';

const args = z
  .tuple([z.string().uuid(), z.string().regex(/^\d{4}-\d{2}$/)])
  .safeParse(process.argv.slice(2));
if (!args.success) {
  console.error('Usage: pnpm findings:draft <tenantId> <YYYY-MM>');
  process.exit(1);
}
const [tenantId, month] = args.data;

generateDraftsForPeriod(tenantId, `${month}-01`)
  .then(async (results) => {
    console.log(`drafted ${results.length} finding(s):`);
    for (const r of results) console.log(`  • ${r.ruleId} — ${r.source}`);
    await closeDbPools();
  })
  .catch(async (err) => {
    console.error('findings:draft failed:', err instanceof Error ? err.message : err);
    await closeDbPools();
    process.exit(1);
  });
