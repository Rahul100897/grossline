// The compute pipeline: metrics for one tenant and one reporting month,
// recomputable at any time, any number of times (upserts on the metric key).
// Later Phase 2 tasks register additional computers here.
import { logger, monthWindow, type MetricPoint, type MonthWindow, type OrderFacts } from '@grossline/core';
import {
  finishMetricRun,
  getTenant,
  startMetricRun,
  upsertMetricValues,
  type Tenant,
} from '@grossline/db';
import { loadOrderFactsForWindow } from './load';
import { revenueComputer } from './computers/revenue';

export type MonthContext = {
  tenant: Tenant;
  year: number;
  month: number;
  window: MonthWindow;
  facts: OrderFacts[];
};

export type MetricComputer = {
  name: string;
  compute(ctx: MonthContext): Promise<MetricPoint[]>;
};

const computers: MetricComputer[] = [revenueComputer];

export function registerComputer(computer: MetricComputer): void {
  computers.push(computer);
}

export function listComputers(): readonly MetricComputer[] {
  return computers;
}

export async function computeMetricsForMonth(
  tenantId: string,
  year: number,
  month: number,
): Promise<{ runId: string; metricsWritten: number }> {
  const tenant = await getTenant(tenantId);
  if (!tenant) throw new Error(`tenant ${tenantId} not found`);
  const window = monthWindow(tenant.reportingTimezone, year, month);
  const monthPeriod = window.dateStrings[0]!;
  const runId = await startMetricRun(tenantId, monthPeriod, window.dateStrings.at(-1)!);

  try {
    const { facts, watermark } = await loadOrderFactsForWindow(tenantId, window);
    const ctx: MonthContext = { tenant, year, month, window, facts };
    let written = 0;
    for (const computer of computers) {
      const points = await computer.compute(ctx);
      written += await upsertMetricValues(tenantId, runId, points);
    }
    await finishMetricRun(tenantId, runId, {
      status: 'success',
      metricsWritten: written,
      rawWatermark: watermark,
    });
    logger.info('metrics computed', { tenantId, period: monthPeriod, written });
    return { runId, metricsWritten: written };
  } catch (err) {
    await finishMetricRun(tenantId, runId, {
      status: 'failed',
      error: err instanceof Error ? err.message : String(err),
    });
    throw err;
  }
}

/** Inclusive month range, e.g. recompute('…', '2026-01', '2026-08'). */
export async function recomputeMetricsRange(
  tenantId: string,
  from: string,
  to: string,
): Promise<{ months: number; metricsWritten: number }> {
  const [fromYear, fromMonth] = from.split('-').map(Number) as [number, number];
  const [toYear, toMonth] = to.split('-').map(Number) as [number, number];
  let year = fromYear;
  let month = fromMonth;
  let months = 0;
  let metricsWritten = 0;
  while (year < toYear || (year === toYear && month <= toMonth)) {
    const result = await computeMetricsForMonth(tenantId, year, month);
    metricsWritten += result.metricsWritten;
    months++;
    month++;
    if (month > 12) {
      month = 1;
      year++;
    }
  }
  return { months, metricsWritten };
}
