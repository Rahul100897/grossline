// Reconciliation: pnpm reconcile <tenantId|slug> <YYYY-MM> [expectedFile]
//
// Compares our totals from the raw tables against the platform UI figures in
// the expected-values file (default: docs/reconciliation/expected/<slug>.json).
// Exit code 1 when any variance is outside tolerance and unexplained.
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { z } from 'zod';
import { closeDbPools } from '@grossline/db';
import { expectedFileSchema, reconcile, type ExpectedFile } from '../reconcile';

const args = z
  .tuple([z.string().min(1), z.string().regex(/^\d{4}-\d{2}$/)])
  .rest(z.string())
  .safeParse(process.argv.slice(2));

if (!args.success) {
  console.error('Usage: pnpm reconcile <tenantId|slug> <YYYY-MM> [expectedFile]');
  process.exit(1);
}

const [tenantIdOrSlug, month, expectedPathArg] = args.data;

function loadExpected(slug: string): ExpectedFile | null {
  const path =
    expectedPathArg ?? join(process.cwd(), '..', '..', 'docs', 'reconciliation', 'expected', `${slug}.json`);
  if (!existsSync(path)) return null;
  return expectedFileSchema.parse(JSON.parse(readFileSync(path, 'utf8')));
}

async function main(): Promise<void> {
  const expected = loadExpected(tenantIdOrSlug);
  const report = await reconcile({ tenantIdOrSlug, month, expected });

  console.log(`\nReconciliation — ${report.tenant} — ${report.month} (${report.currency})\n`);
  const fmt = (n: number | null) => (n === null ? '—' : n.toFixed(2));
  console.table(
    report.rows.map((r) => ({
      metric: r.metric,
      ours: fmt(r.ours),
      platform: fmt(r.expected),
      variance: fmt(r.variance),
      'variance %': r.variancePct === null ? '—' : `${r.variancePct.toFixed(3)}%`,
      'tolerance %': `${r.tolerancePct}%`,
      status: r.status.toUpperCase(),
      note: r.note ?? '',
    })),
  );
  if (report.structuralNotes.length > 0) {
    console.log('Structural notes:');
    for (const note of report.structuralNotes) console.log(`  • ${note}`);
  }
  if (!expected) {
    console.log(
      '\nNo expected-values file found. Record the platform UI figures per docs/reconciliation.md.',
    );
  }
  console.log(report.ok ? '\nOK — every variance within tolerance or explained.' : '\nFAIL — unexplained variance outside tolerance.');
  if (!report.ok) process.exitCode = 1;
}

main()
  .then(() => closeDbPools())
  .catch(async (err) => {
    console.error('reconcile failed:', err instanceof Error ? err.message : err);
    await closeDbPools();
    process.exit(1);
  });
