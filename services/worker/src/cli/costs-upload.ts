// Upload unit costs from CSV:
//
//   pnpm costs:upload <tenantId> <file.csv>
//
// Columns (header row required, any order): sku, variant_id, unit_cost,
// currency, effective_from. Each row needs sku or variant_id (or both),
// unit_cost as a decimal string ("14.00"), a 3-letter currency, and
// effective_from as YYYY-MM-DD. Valid rows are applied; every invalid row is
// reported with its line number; any error exits 1 so failures are visible.
import { readFileSync } from 'node:fs';
import { z } from 'zod';
import { decimalToMinorUnits, parseCsv } from '@grossline/core';
import { closeDbPools, upsertProductCosts, type ProductCostInput } from '@grossline/db';

const args = z.tuple([z.string().uuid(), z.string().min(1)]).safeParse(process.argv.slice(2));
if (!args.success) {
  console.error('Usage: pnpm costs:upload <tenantId> <file.csv>');
  process.exit(1);
}
const [tenantId, filePath] = args.data;

const REQUIRED_COLUMNS = ['unit_cost', 'currency', 'effective_from'];
const KNOWN_COLUMNS = ['sku', 'variant_id', ...REQUIRED_COLUMNS];

async function main(): Promise<void> {
  const rows = parseCsv(readFileSync(filePath, 'utf8'));
  if (rows.length === 0) throw new Error('empty file');
  const header = rows[0]!.map((h) => h.trim().toLowerCase());

  const unknown = header.filter((h) => !KNOWN_COLUMNS.includes(h));
  const missing = REQUIRED_COLUMNS.filter((c) => !header.includes(c));
  if (unknown.length > 0 || missing.length > 0) {
    if (unknown.length > 0) console.error(`unknown column(s): ${unknown.join(', ')}`);
    if (missing.length > 0) console.error(`missing column(s): ${missing.join(', ')}`);
    if (!header.includes('sku') && !header.includes('variant_id')) {
      console.error('need a sku or variant_id column');
    }
    process.exit(1);
  }
  if (!header.includes('sku') && !header.includes('variant_id')) {
    console.error('need a sku or variant_id column');
    process.exit(1);
  }

  const col = (row: string[], name: string): string => {
    const idx = header.indexOf(name);
    return idx === -1 ? '' : (row[idx] ?? '').trim();
  };

  const valid: ProductCostInput[] = [];
  const errors: { line: number; error: string }[] = [];

  rows.slice(1).forEach((row, i) => {
    const line = i + 2; // 1-based, after header
    try {
      const sku = col(row, 'sku');
      const variantId = col(row, 'variant_id');
      if (sku === '' && variantId === '') throw new Error('needs sku or variant_id');
      const currency = col(row, 'currency').toUpperCase();
      if (!/^[A-Z]{3}$/.test(currency)) throw new Error(`bad currency "${col(row, 'currency')}"`);
      const effectiveFrom = col(row, 'effective_from');
      if (!/^\d{4}-\d{2}-\d{2}$/.test(effectiveFrom)) {
        throw new Error(`bad effective_from "${effectiveFrom}" (want YYYY-MM-DD)`);
      }
      const unitCostMinor = decimalToMinorUnits(col(row, 'unit_cost'), currency);
      if (unitCostMinor < 0) throw new Error('unit_cost must not be negative');
      valid.push({ sku, variantId, unitCostMinor, currency, effectiveFrom, source: 'upload' });
    } catch (err) {
      errors.push({ line, error: err instanceof Error ? err.message : String(err) });
    }
  });

  const applied = await upsertProductCosts(tenantId, valid);
  console.log(`applied ${applied} cost row(s)`);
  if (errors.length > 0) {
    console.error(`\n${errors.length} row(s) rejected:`);
    for (const e of errors) console.error(`  line ${e.line}: ${e.error}`);
    process.exitCode = 1;
  }
}

main()
  .then(() => closeDbPools())
  .catch(async (err) => {
    console.error('costs:upload failed:', err instanceof Error ? err.message : err);
    await closeDbPools();
    process.exit(1);
  });
