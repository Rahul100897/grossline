// Normalises raw ad rows into PlatformDay records (converted to the reporting
// currency per day, rates recorded) for the ad-platform computer.
import { inArray } from 'drizzle-orm';
import { z } from 'zod';
import { decimalToMinorUnits, minorUnitExponent, type PlatformDay } from '@grossline/core';
import { listConnections, schema, withTenant } from '@grossline/db';
import { convertMinorOnDate, type FxTrace } from './ad-spend';

const metaRowSchema = z
  .object({
    spend: z.string().optional(),
    account_currency: z.string().optional(),
    campaign_id: z.string().optional(),
    campaign_name: z.string().optional(),
    impressions: z.string().optional(),
    clicks: z.string().optional(),
    actions: z.array(z.object({ action_type: z.string(), value: z.string() })).optional(),
    action_values: z.array(z.object({ action_type: z.string(), value: z.string() })).optional(),
  })
  .passthrough();

const googleRowSchema = z
  .object({
    campaign: z
      .object({ id: z.union([z.string(), z.number()]), name: z.string().optional() })
      .passthrough()
      .optional(),
    metrics: z
      .object({
        costMicros: z.string().optional(),
        impressions: z.string().optional(),
        clicks: z.string().optional(),
        conversions: z.number().optional(),
        conversionsValue: z.number().optional(),
      })
      .passthrough()
      .optional(),
  })
  .passthrough();

const purchase = (entries: { action_type: string; value: string }[] | undefined): number => {
  const found = entries?.find((e) => e.action_type === 'purchase');
  return found ? Number(found.value) : 0;
};

export async function loadPlatformDays(
  tenantId: string,
  dateStrings: string[],
  reportingCurrency: string,
): Promise<{ days: PlatformDay[]; fxTrace: FxTrace[] }> {
  const connections = await listConnections(tenantId);
  const currencyByConnection = new Map(
    connections.map((c) => [c.id, c.accountCurrency ?? reportingCurrency]),
  );
  const trace: FxTrace[] = [];
  const days: PlatformDay[] = [];

  const metaRows = await withTenant(tenantId, (tx) =>
    tx
      .select()
      .from(schema.rawMetaInsights)
      .where(inArray(schema.rawMetaInsights.date, dateStrings)),
  );
  for (const row of metaRows) {
    const payload = metaRowSchema.parse(row.payload);
    const currency = payload.account_currency ?? currencyByConnection.get(row.connectionId) ?? reportingCurrency;
    const spendMinor = payload.spend ? decimalToMinorUnits(payload.spend, currency) : 0;
    const valueMinor = (() => {
      const raw = payload.action_values?.find((e) => e.action_type === 'purchase')?.value;
      return raw ? decimalToMinorUnits(raw, currency) : 0;
    })();
    days.push({
      platform: 'meta',
      level: row.level === 'account' ? 'account' : 'campaign',
      campaignId: row.campaignId === '' ? null : row.campaignId,
      campaignName: payload.campaign_name ?? null,
      date: row.date,
      spendMinor: await convertMinorOnDate('meta', spendMinor, currency, reportingCurrency, row.date, trace),
      impressions: Number(payload.impressions ?? 0),
      clicks: Number(payload.clicks ?? 0),
      conversions: purchase(payload.actions),
      conversionValueMinor: await convertMinorOnDate('meta', valueMinor, currency, reportingCurrency, row.date, trace),
    });
  }

  const googleRows = await withTenant(tenantId, (tx) =>
    tx
      .select()
      .from(schema.rawGoogleAdsInsights)
      .where(inArray(schema.rawGoogleAdsInsights.date, dateStrings)),
  );
  for (const row of googleRows) {
    const payload = googleRowSchema.parse(row.payload);
    const currency = currencyByConnection.get(row.connectionId) ?? reportingCurrency;
    const exponent = minorUnitExponent(currency);
    const spendMinor = payload.metrics?.costMicros
      ? Math.round((Number(payload.metrics.costMicros) / 1_000_000) * 10 ** exponent)
      : 0;
    const valueMinor = Math.round((payload.metrics?.conversionsValue ?? 0) * 10 ** exponent);
    days.push({
      platform: 'google_ads',
      level: 'campaign',
      campaignId: String(payload.campaign?.id ?? row.campaignId),
      campaignName: payload.campaign?.name ?? null,
      date: row.date,
      spendMinor: await convertMinorOnDate('google_ads', spendMinor, currency, reportingCurrency, row.date, trace),
      impressions: Number(payload.metrics?.impressions ?? 0),
      clicks: Number(payload.metrics?.clicks ?? 0),
      conversions: payload.metrics?.conversions ?? 0,
      conversionValueMinor: await convertMinorOnDate('google_ads', valueMinor, currency, reportingCurrency, row.date, trace),
    });
  }

  return { days, fxTrace: trace };
}
