// Task 2.9 done-when: any metric can be requested with any comparison, and
// missing history returns an explicit absent value — never zero, never a
// misleading percentage.
import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createTenant } from '../src/admin';
import { closeDbPools } from '../src/client';
import { compareMetric, rollingMetric } from '../src/comparisons';
import { upsertMetricValues } from '../src/metric-values';

let tenantId: string;

beforeAll(async () => {
  tenantId = (
    await createTenant({
      name: 'Comparison tenant',
      slug: `cmp-${randomUUID().slice(0, 8)}`,
      reportingCurrency: 'USD',
      reportingTimezone: 'UTC',
    })
  ).id;
  await upsertMetricValues(tenantId, null, [
    { metric: 'net_sales', grain: 'month', period: '2026-07-01', value: 10320, currency: 'USD' },
    { metric: 'net_sales', grain: 'month', period: '2026-08-01', value: 48200, currency: 'USD' },
    { metric: 'order_count', grain: 'month', period: '2026-08-01', value: 6 },
    { metric: 'returns', grain: 'month', period: '2026-07-01', value: 0, currency: 'USD' },
    { metric: 'returns', grain: 'month', period: '2026-08-01', value: 21600, currency: 'USD' },
    // 10 consecutive daily rows, 100..1000
    ...Array.from({ length: 10 }, (_, i) => ({
      metric: 'net_sales',
      grain: 'day' as const,
      period: `2026-08-${String(i + 1).padStart(2, '0')}`,
      value: (i + 1) * 100,
      currency: 'USD',
    })),
  ]);
});

afterAll(async () => {
  await closeDbPools();
});

describe('month over month', () => {
  it('computes delta and percentage from two present months', async () => {
    const cmp = await compareMetric(tenantId, {
      metric: 'net_sales',
      period: '2026-08-01',
      kind: 'previous_period',
    });
    expect(cmp).toMatchObject({
      comparisonPeriod: '2026-07-01',
      current: 48200,
      previous: 10320,
      delta: 37880,
      currency: 'USD',
    });
    expect(cmp.deltaPct).toBeCloseTo(3.670543, 5); // 37880 / 10320
  });

  it('a zero previous value yields delta but NO percentage', async () => {
    const cmp = await compareMetric(tenantId, {
      metric: 'returns',
      period: '2026-08-01',
      kind: 'previous_period',
    });
    expect(cmp.previous).toBe(0);
    expect(cmp.delta).toBe(21600);
    expect(cmp.deltaPct).toBeNull(); // Δ% against zero would mislead
  });
});

describe('year over year degrades gracefully', () => {
  it('missing history is absent — not zero, no percentage', async () => {
    const cmp = await compareMetric(tenantId, {
      metric: 'net_sales',
      period: '2026-08-01',
      kind: 'year_over_year',
    });
    expect(cmp.comparisonPeriod).toBe('2025-08-01');
    expect(cmp.current).toBe(48200);
    expect(cmp.previous).toBeNull();
    expect(cmp.delta).toBeNull();
    expect(cmp.deltaPct).toBeNull();
  });

  it('an entirely uncomputed metric is absent on both sides', async () => {
    const cmp = await compareMetric(tenantId, {
      metric: 'mer',
      period: '2026-08-01',
      kind: 'previous_period',
    });
    expect(cmp.current).toBeNull();
    expect(cmp.previous).toBeNull();
    expect(cmp.deltaPct).toBeNull();
  });
});

describe('rolling windows over the daily series', () => {
  it('rolling 7 sums exactly the last seven days', async () => {
    const rolling = await rollingMetric(tenantId, {
      metric: 'net_sales',
      endDate: '2026-08-10',
      days: 7,
    });
    // days 4..10 → 400+500+…+1000 = 4900
    expect(rolling.value).toBe(4900);
    expect(rolling.complete).toBe(true);
  });

  it('a partially covered window says so instead of pretending', async () => {
    const rolling = await rollingMetric(tenantId, {
      metric: 'net_sales',
      endDate: '2026-08-10',
      days: 28,
    });
    expect(rolling.value).toBe(5500); // the ten days that exist
    expect(rolling.daysWithData).toBe(10);
    expect(rolling.complete).toBe(false);
  });

  it('a window with no data at all is absent', async () => {
    const rolling = await rollingMetric(tenantId, {
      metric: 'net_sales',
      endDate: '2020-01-31',
      days: 90,
    });
    expect(rolling.value).toBeNull();
    expect(rolling.daysWithData).toBe(0);
  });
});
