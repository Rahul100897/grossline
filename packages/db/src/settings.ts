// Console settings (docs/phase-3.md task 3.8): one global row holding plan
// prices, default thresholds and alert preferences as a jsonb blob, on the
// admin connection. Metric definitions are deliberately NOT stored here — the
// definitions page renders docs/metrics.md directly so it cannot drift.
import { eq } from 'drizzle-orm';
import { z } from 'zod';
import { adminDb } from './client';
import { appSettings } from './schema';

export const planPriceSchema = z.object({
  plan: z.string().min(1),
  monthlyFeeMinor: z.number().int(),
  currency: z.string().length(3),
});

export const settingsSchema = z.object({
  plans: z.array(planPriceSchema).default([]),
  thresholds: z
    .object({
      /** Cost completeness below this flags a cost-data issue (0..1). */
      costCompleteness: z.number().min(0).max(1).default(1),
      /** Onboarding older than this (days) flags a stalled-onboarding issue. */
      onboardingStaleDays: z.number().int().min(1).default(3),
    })
    .default({ costCompleteness: 1, onboardingStaleDays: 3 }),
  alerts: z
    .object({
      emailOnNewTicket: z.boolean().default(true),
      emailOnBlockingIssue: z.boolean().default(false),
    })
    .default({ emailOnNewTicket: true, emailOnBlockingIssue: false }),
});

export type AppSettings = z.infer<typeof settingsSchema>;
export type PlanPrice = z.infer<typeof planPriceSchema>;

/** Current settings, filled with defaults for anything unset. */
export async function getSettings(): Promise<AppSettings> {
  const [row] = await adminDb().select().from(appSettings).limit(1);
  return settingsSchema.parse(row?.data ?? {});
}

/** Merge a partial patch into the settings blob and persist it. */
export async function updateSettings(patch: Partial<AppSettings>): Promise<AppSettings> {
  const current = await getSettings();
  const next = settingsSchema.parse({ ...current, ...patch });
  const [existing] = await adminDb().select({ id: appSettings.id }).from(appSettings).limit(1);
  if (existing) {
    await adminDb()
      .update(appSettings)
      .set({ data: next, updatedAt: new Date() })
      .where(eq(appSettings.id, existing.id));
  } else {
    await adminDb().insert(appSettings).values({ data: next });
  }
  return next;
}
