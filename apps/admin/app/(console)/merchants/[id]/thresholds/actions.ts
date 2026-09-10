'use server';

import { redirect } from 'next/navigation';
import { z } from 'zod';
import { saveEditedCalibration, thresholdsSchema, writeAuditLog } from '@grossline/db';
import { calibrateTenant } from '@grossline/worker/findings-calibrate';
import { requireSession } from '../../../../../lib/auth';

/** Recompute thresholds from the tenant's history, overwriting any hand edits. */
export async function recalibrate(formData: FormData): Promise<void> {
  const session = await requireSession();
  const tenantId = z.string().uuid().parse(formData.get('tenantId'));
  const back = `/merchants/${tenantId}/thresholds`;
  let failure: string | null = null;
  try {
    await calibrateTenant(tenantId, { force: true });
    await writeAuditLog({ actor: session.sub, action: 'tenant.thresholds.recalibrate', tenantId });
  } catch (error) {
    failure =
      error instanceof Error
        ? (error.message.split('\n')[0] ?? error.message)
        : 'could not recalibrate';
  }
  if (failure !== null) redirect(`${back}?error=${encodeURIComponent(failure)}`);
  redirect(`${back}?recalibrated=1`);
}

const formSchema = z.object({
  tenantId: z.string().uuid(),
  breakEvenMer: z.string(),
  minImpactMinor: z.string(),
  deadCampaignSpendFloorMinor: z.string(),
  brandedShareCeil: z.string(),
  refundRateMultiple: z.string(),
  discountLeakageDeltaCeil: z.string(),
  claimGapTolerance: z.string(),
  cacCeilingMinor: z.string(),
  pacingOveragePct: z.string(),
  searchTermWasteFloorMinor: z.string(),
});

const numOrNull = (v: string): number | null => (v.trim() === '' ? null : Number(v));

export async function saveThresholds(formData: FormData): Promise<void> {
  const session = await requireSession();
  const field = (name: string): string => String(formData.get(name) ?? '');
  const tenantId = field('tenantId');
  const back = `/merchants/${tenantId}/thresholds`;

  let failure: string | null = null;
  try {
    const raw = formSchema.parse({
      tenantId,
      breakEvenMer: field('breakEvenMer'),
      minImpactMinor: field('minImpactMinor'),
      deadCampaignSpendFloorMinor: field('deadCampaignSpendFloorMinor'),
      brandedShareCeil: field('brandedShareCeil'),
      refundRateMultiple: field('refundRateMultiple'),
      discountLeakageDeltaCeil: field('discountLeakageDeltaCeil'),
      claimGapTolerance: field('claimGapTolerance'),
      cacCeilingMinor: field('cacCeilingMinor'),
      pacingOveragePct: field('pacingOveragePct'),
      searchTermWasteFloorMinor: field('searchTermWasteFloorMinor'),
    });
    // The stored fractions are 0..1; the form shows shares as percentages.
    const thresholds = thresholdsSchema.parse({
      breakEvenMer: numOrNull(raw.breakEvenMer),
      minImpactMinor: Math.round(Number(raw.minImpactMinor)),
      deadCampaignSpendFloorMinor: Math.round(Number(raw.deadCampaignSpendFloorMinor)),
      brandedShareCeil: Number(raw.brandedShareCeil) / 100,
      refundRateMultiple: Number(raw.refundRateMultiple),
      discountLeakageDeltaCeil: Number(raw.discountLeakageDeltaCeil) / 100,
      claimGapTolerance: Number(raw.claimGapTolerance) / 100,
      cacCeilingMinor:
        raw.cacCeilingMinor.trim() === '' ? null : Math.round(Number(raw.cacCeilingMinor)),
      pacingOveragePct: Number(raw.pacingOveragePct) / 100,
      searchTermWasteFloorMinor: Math.round(Number(raw.searchTermWasteFloorMinor)),
    });
    await saveEditedCalibration(tenantId, thresholds);
    await writeAuditLog({ actor: session.sub, action: 'tenant.thresholds.edit', tenantId });
  } catch (error) {
    failure =
      error instanceof Error ? (error.message.split('\n')[0] ?? error.message) : 'could not save';
  }
  if (failure !== null) redirect(`${back}?error=${encodeURIComponent(failure)}`);
  redirect(`${back}?saved=1`);
}
