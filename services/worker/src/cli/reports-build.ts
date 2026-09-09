// Build (and persist the snapshot for) a monthly report:
//   pnpm reports:build <tenantId> <YYYY-MM>
import { z } from 'zod';
import { closeDbPools } from '@grossline/db';
import { buildAndSaveReport } from '../reports/pipeline';

const args = z
  .tuple([z.string().uuid(), z.string().regex(/^\d{4}-\d{2}$/)])
  .safeParse(process.argv.slice(2));
if (!args.success) {
  console.error('Usage: pnpm reports:build <tenantId> <YYYY-MM>');
  process.exit(1);
}
const [tenantId, month] = args.data;
const period = `${month}-01`;

buildAndSaveReport(tenantId, period)
  .then(async ({ report, model }) => {
    console.log(`\nReport — ${period} (${report.status})`);
    console.log(`  ${model.headline.sentence}`);
    console.log(`  findings: ${model.findings.map((f) => `${f.title}/${f.family}`).join(', ') || 'none'}`);
    await closeDbPools();
  })
  .catch(async (err) => {
    console.error('reports:build failed:', err instanceof Error ? err.message : err);
    await closeDbPools();
    process.exit(1);
  });
