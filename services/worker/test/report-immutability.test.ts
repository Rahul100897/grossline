import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { closeDbPools, createTenant, getReport, schema, withTenant } from '@grossline/db';
import { buildAndSaveReport, renderStoredReport } from '../src/reports/pipeline';
import { buildReportModel } from '../src/reports/build-model';

// task 5.B3 — a report built in the past renders identically after a definition
// change or a cost re-upload, because it renders from the stored snapshot, never
// a live query. We seed metrics, build+store the report, then mutate the live
// metric layer and prove the stored render is unchanged (while a fresh build
// would differ).
let tenantId: string;
const period = '2026-08-01';

async function putMetric(metric: string, value: number, scope = ''): Promise<void> {
  await withTenant(tenantId, (tx) =>
    tx
      .insert(schema.metricValues)
      .values({
        tenantId,
        metric,
        grain: 'month',
        period,
        scope,
        value: String(value),
        currency: 'USD',
      })
      .onConflictDoUpdate({
        target: [
          schema.metricValues.tenantId,
          schema.metricValues.metric,
          schema.metricValues.grain,
          schema.metricValues.period,
          schema.metricValues.scope,
        ],
        set: { value: String(value) },
      }),
  );
}

beforeAll(async () => {
  tenantId = (
    await createTenant({
      name: 'Snapshot Brand',
      slug: `snapshot-${randomUUID().slice(0, 8)}`,
      reportingCurrency: 'USD',
      reportingTimezone: 'UTC',
    })
  ).id;
  // Minimal but complete month.
  await putMetric('gross_sales', 2_000_000);
  await putMetric('discounts', 140_000);
  await putMetric('net_sales', 1_860_000);
  await putMetric('cogs', 560_000);
  await putMetric('gross_profit', 1_300_000);
  await putMetric('total_ad_spend', 500_000);
  await putMetric('contribution_after_ad_spend', 800_000);
  await putMetric('mer', 3.72);
  await putMetric('blended_cac', 5000);
  await putMetric('first_order_contribution', 6000);
  await putMetric('order_count', 220);
});

afterAll(async () => {
  await closeDbPools();
});

describe('report snapshot immutability (task 5.B3)', () => {
  it('renders a past report identically after the live metric layer changes', async () => {
    const { report } = await buildAndSaveReport(tenantId, period);
    const before = renderStoredReport(report);
    expect(before).toContain('USD 18,600.00'); // net sales as built

    // A later definition change / cost re-upload recomputes net sales.
    await putMetric('net_sales', 9_999_999);
    await putMetric('contribution_after_ad_spend', 111_111);

    // A fresh build would reflect the new numbers…
    const freshModel = await buildReportModel(tenantId, period);
    const freshNet = freshModel.margin.rows.find((r) => r.label === 'Net sales');
    expect(freshNet?.amountMinor).toBe(9_999_999);

    // …but the stored snapshot renders exactly as it did when built.
    const stored = await getReport(tenantId, period);
    expect(stored).not.toBeNull();
    const after = renderStoredReport(stored!);
    expect(after).toBe(before);
    expect(after).toContain('USD 18,600.00');
    expect(after).not.toContain('99,999.99');
  });
});
