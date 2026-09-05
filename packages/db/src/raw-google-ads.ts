// Raw Google Ads landing zone. One row per (campaign, day), upserted on that
// key — conversion lag restates recent days, so a re-pull replaces the payload
// rather than duplicating it. Payloads land exactly as the API sent them.
import { count, sql } from 'drizzle-orm';
import { rawGoogleAdsInsights } from './schema';
import { withTenant } from './tenant-scope';

export type GoogleAdsInsightRow = {
  customerId: string;
  campaignId: string;
  date: string; // YYYY-MM-DD in the ad account's timezone
  payload: Record<string, unknown>;
};

export async function upsertRawGoogleAdsInsights(
  tenantId: string,
  connectionId: string,
  rows: GoogleAdsInsightRow[],
): Promise<number> {
  if (rows.length === 0) return 0;
  await withTenant(tenantId, (tx) =>
    tx
      .insert(rawGoogleAdsInsights)
      .values(rows.map((r) => ({ ...r, tenantId, connectionId })))
      .onConflictDoUpdate({
        target: [
          rawGoogleAdsInsights.tenantId,
          rawGoogleAdsInsights.connectionId,
          rawGoogleAdsInsights.campaignId,
          rawGoogleAdsInsights.date,
        ],
        set: { payload: sql`excluded.payload`, syncedAt: sql`now()` },
      }),
  );
  return rows.length;
}

export async function countRawGoogleAdsInsights(tenantId: string): Promise<number> {
  return withTenant(tenantId, async (tx) => {
    const [row] = await tx.select({ n: count() }).from(rawGoogleAdsInsights);
    return row?.n ?? 0;
  });
}
