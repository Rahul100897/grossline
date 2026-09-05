// The golden-FILE harness (task 2.10): every metric the pipeline computes for
// the fixture tenant, serialized to committed JSON. When a definition changes,
// regenerating (UPDATE_GOLDENS=1 pnpm --filter @grossline/worker test) makes
// the change show up as a readable per-metric diff in the PR — the mechanism
// that makes a definition change visible rather than silent.
//
// Correctness is pinned separately by the HAND-CALCULATED tests
// (metrics-*.test.ts); these files pin change-visibility.
import { randomUUID } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterAll, describe, expect, it } from 'vitest';
import {
  closeDbPools,
  createStore,
  createTenant,
  listMetricValuesForPeriod,
  upsertProductCosts,
  upsertTenantCostInputs,
} from '@grossline/db';
import { computeMetricsForMonth } from '../src/metrics/pipeline';
import { loadRecordedOrders } from './helpers/recorded-orders';

const goldensDir = join(dirname(fileURLToPath(import.meta.url)), 'goldens');
const UPDATE = process.env.UPDATE_GOLDENS === '1';

type GoldenRow = {
  metric: string;
  grain: string;
  period: string;
  scope: string;
  value: number;
  currency: string | null;
  meta: unknown;
};

async function goldenRows(tenantId: string, period: string): Promise<GoldenRow[]> {
  const monthRows = await listMetricValuesForPeriod(tenantId, 'month', period);
  return monthRows
    .map((r) => ({
      metric: r.metric,
      grain: r.grain,
      period: r.period,
      scope: r.scope,
      value: Number(r.value),
      currency: r.currency,
      meta: r.meta,
    }))
    .sort((a, b) => `${a.metric}|${a.scope}`.localeCompare(`${b.metric}|${b.scope}`));
}

function assertGolden(name: string, rows: GoldenRow[]): void {
  const file = join(goldensDir, `${name}.json`);
  if (UPDATE || !existsSync(file)) {
    mkdirSync(goldensDir, { recursive: true });
    writeFileSync(file, JSON.stringify(rows, null, 2) + '\n');
    if (!UPDATE) throw new Error(`golden ${name} did not exist — written; commit it and rerun`);
    return;
  }
  const expected = JSON.parse(readFileSync(file, 'utf8')) as GoldenRow[];
  // toEqual produces the readable per-field diff when a definition changed.
  expect(rows).toEqual(expected);
}

afterAll(async () => {
  await closeDbPools();
});

describe('golden files — fixture tenant, full month output', () => {
  it('July and August 2026 match the committed goldens', async () => {
    const tenantId = (
      await createTenant({
        name: 'Golden tenant',
        slug: `golden-${randomUUID().slice(0, 8)}`,
        reportingCurrency: 'USD',
        reportingTimezone: 'America/New_York',
      })
    ).id;
    const store = await createStore({
      tenantId,
      shopDomain: `golden-${randomUUID().slice(0, 8)}.myshopify.com`,
      storeCurrency: 'USD',
      storeTimezone: 'America/New_York',
    });
    await loadRecordedOrders(tenantId, store.id);
    await upsertProductCosts(tenantId, [
      { sku: 'ABT141A-10', unitCostMinor: 600, currency: 'USD', effectiveFrom: '2026-01-01', source: 'upload' },
      { sku: 'ABT141A-1115', unitCostMinor: 1000, currency: 'USD', effectiveFrom: '2026-01-01', source: 'upload' },
      { sku: 'ABT141A-210', unitCostMinor: 500, currency: 'USD', effectiveFrom: '2026-01-01', source: 'upload' },
      { sku: 'ABT151U-5', unitCostMinor: 1500, currency: 'USD', effectiveFrom: '2026-01-01', source: 'upload' },
    ]);
    await upsertTenantCostInputs(tenantId, {
      effectiveFrom: '2026-01-01',
      currency: 'USD',
      paymentFeeBp: 290,
      paymentFeeFixedMinor: 30,
      shippingCostPerOrderMinor: 400,
      fulfilmentCostPerOrderMinor: 250,
      packagingCostPerOrderMinor: 100,
      monthlySpendTargetMinor: 6_000_000,
    });
    // Frozen `now` so provisional flags and cohort offsets never rot the goldens.
    const NOW = new Date('2026-09-06T12:00:00Z');
    await computeMetricsForMonth(tenantId, 2026, 7, NOW);
    await computeMetricsForMonth(tenantId, 2026, 8, NOW);

    assertGolden('fixture-tenant-2026-07', await goldenRows(tenantId, '2026-07-01'));
    assertGolden('fixture-tenant-2026-08', await goldenRows(tenantId, '2026-08-01'));
  });
});
