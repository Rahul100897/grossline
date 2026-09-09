// Worker calibration (docs/phase-4.md task 4.2): read the tenant's recent
// months from the metric layer, build the pure calibration input, compute
// thresholds and store them — unless the analyst has hand-edited them.
import {
  calibrateThresholds,
  logger,
  type CalibrationInput,
  type CalibrationMonth,
  type FindingThresholds,
} from '@grossline/core';
import {
  getCalibration,
  getTenant,
  listMetricPeriods,
  listMetricValuesForPeriod,
  saveComputedCalibration,
} from '@grossline/db';

const DEFAULT_MONTHS_BACK = 3; // ~90 days

async function monthFor(tenantId: string, period: string): Promise<CalibrationMonth> {
  const rows = await listMetricValuesForPeriod(tenantId, 'month', period);
  const tenantVal = (metric: string): number | null => {
    const row = rows.find((r) => r.metric === metric && r.scope === '');
    return row ? Number(row.value) : null;
  };
  const breakEvenRow = rows.find((r) => r.metric === 'break_even_roas' && r.scope === '');
  const contributionMarginRate =
    breakEvenRow && typeof (breakEvenRow.meta as { contributionMarginRate?: unknown })?.contributionMarginRate === 'number'
      ? ((breakEvenRow.meta as { contributionMarginRate: number }).contributionMarginRate)
      : null;

  const gross = tenantVal('gross_sales');
  const discounts = tenantVal('discounts');
  const discountShare = gross !== null && gross !== 0 && discounts !== null ? discounts / gross : null;

  const claimGaps = rows
    .filter((r) => r.metric === 'claim_gap' && r.scope !== '')
    .map((r) => Number(r.value))
    .filter((v) => Number.isFinite(v));

  return {
    period,
    contributionMarginRate,
    breakEvenRoas: tenantVal('break_even_roas'),
    totalAdSpendMinor: tenantVal('total_ad_spend'),
    blendedCacMinor: tenantVal('blended_cac'),
    discountShare,
    claimGaps,
  };
}

export async function buildCalibrationInput(
  tenantId: string,
  monthsBack = DEFAULT_MONTHS_BACK,
): Promise<CalibrationInput> {
  const tenant = await getTenant(tenantId);
  if (!tenant) throw new Error(`tenant not found: ${tenantId}`);
  const periods = (await listMetricPeriods(tenantId, 'month')).slice(0, monthsBack);
  const months = await Promise.all(periods.map((p) => monthFor(tenantId, p)));
  return { currency: tenant.reportingCurrency, months };
}

/**
 * Calibrate a tenant and store the result. Skips storing when the analyst has
 * hand-edited the thresholds (edited=true), returning the existing set.
 */
export async function calibrateTenant(
  tenantId: string,
  opts: { monthsBack?: number; force?: boolean } = {},
): Promise<{ thresholds: FindingThresholds; stored: boolean }> {
  const existing = await getCalibration(tenantId);
  if (existing?.edited && !opts.force) {
    logger.info('calibration skipped — analyst-edited thresholds kept', { tenantId });
    return { thresholds: existing.thresholds, stored: false };
  }
  const input = await buildCalibrationInput(tenantId, opts.monthsBack);
  const thresholds = calibrateThresholds(input);
  await saveComputedCalibration(tenantId, thresholds);
  logger.info('calibration computed', {
    tenantId,
    months: input.months.length,
    breakEvenMer: thresholds.breakEvenMer,
    minImpactMinor: thresholds.minImpactMinor,
  });
  return { thresholds, stored: true };
}

/** Read stored thresholds, calibrating on the fly if none exist yet. */
export async function thresholdsFor(tenantId: string): Promise<FindingThresholds> {
  const existing = await getCalibration(tenantId);
  if (existing) return existing.thresholds;
  const { thresholds } = await calibrateTenant(tenantId);
  return thresholds;
}
