// Per-tenant calibration storage (docs/phase-4.md task 4.2). One row per
// tenant, the FindingThresholds blob validated on the way in and out. The
// `edited` flag records that an analyst hand-tuned the values so an automatic
// recalibration leaves them alone.
import { eq } from 'drizzle-orm';
import { z } from 'zod';
import type { FindingThresholds } from '@grossline/core';
import { tenantCalibration } from './schema';
import { withTenant } from './tenant-scope';

export const thresholdsSchema = z.object({
  breakEvenMer: z.number().nullable(),
  minImpactMinor: z.number().int().min(0),
  deadCampaignSpendFloorMinor: z.number().int().min(0),
  brandedShareCeil: z.number().min(0).max(1),
  refundRateMultiple: z.number().min(1),
  discountLeakageDeltaCeil: z.number().min(0).max(1),
  claimGapTolerance: z.number().min(0).max(1),
  cacCeilingMinor: z.number().int().nullable(),
  pacingOveragePct: z.number().min(0),
  searchTermWasteFloorMinor: z.number().int().min(0),
}) satisfies z.ZodType<FindingThresholds>;

export type TenantCalibration = {
  tenantId: string;
  thresholds: FindingThresholds;
  edited: boolean;
  computedAt: Date;
  updatedAt: Date;
};

export async function getCalibration(tenantId: string): Promise<TenantCalibration | null> {
  const [row] = await withTenant(tenantId, (tx) =>
    tx.select().from(tenantCalibration).where(eq(tenantCalibration.tenantId, tenantId)).limit(1),
  );
  if (!row) return null;
  return {
    tenantId: row.tenantId,
    thresholds: thresholdsSchema.parse(row.data),
    edited: row.edited,
    computedAt: row.computedAt,
    updatedAt: row.updatedAt,
  };
}

/** Store freshly-computed thresholds (edited=false). */
export async function saveComputedCalibration(
  tenantId: string,
  thresholds: FindingThresholds,
): Promise<void> {
  const data = thresholdsSchema.parse(thresholds);
  await withTenant(tenantId, (tx) =>
    tx
      .insert(tenantCalibration)
      .values({ tenantId, data, edited: false, computedAt: new Date(), updatedAt: new Date() })
      .onConflictDoUpdate({
        target: tenantCalibration.tenantId,
        set: { data, edited: false, computedAt: new Date(), updatedAt: new Date() },
      }),
  );
}

/** Store analyst-edited thresholds (edited=true so recalibration skips them). */
export async function saveEditedCalibration(
  tenantId: string,
  thresholds: FindingThresholds,
): Promise<void> {
  const data = thresholdsSchema.parse(thresholds);
  await withTenant(tenantId, (tx) =>
    tx
      .insert(tenantCalibration)
      .values({ tenantId, data, edited: true, updatedAt: new Date() })
      .onConflictDoUpdate({
        target: tenantCalibration.tenantId,
        set: { data, edited: true, updatedAt: new Date() },
      }),
  );
}
