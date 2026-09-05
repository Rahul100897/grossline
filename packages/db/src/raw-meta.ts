// Raw Meta insights landing zone. One row per (level, campaign, day), upserted
// on that key — Meta restates recent days, so a re-pull replaces the payload
// for the same day rather than duplicating it. Payloads land exactly as sent.
import { count, sql } from 'drizzle-orm';
import { rawMetaInsights } from './schema';
import { withTenant } from './tenant-scope';

export type MetaInsightRow = {
  adAccountId: string;
  level: 'account' | 'campaign';
  campaignId: string;
  date: string; // YYYY-MM-DD in the ad account's timezone
  payload: Record<string, unknown>;
};

export async function upsertRawMetaInsights(
  tenantId: string,
  connectionId: string,
  rows: MetaInsightRow[],
): Promise<number> {
  if (rows.length === 0) return 0;
  await withTenant(tenantId, (tx) =>
    tx
      .insert(rawMetaInsights)
      .values(rows.map((r) => ({ ...r, tenantId, connectionId })))
      .onConflictDoUpdate({
        target: [
          rawMetaInsights.tenantId,
          rawMetaInsights.connectionId,
          rawMetaInsights.level,
          rawMetaInsights.campaignId,
          rawMetaInsights.date,
        ],
        set: { payload: sql`excluded.payload`, syncedAt: sql`now()` },
      }),
  );
  return rows.length;
}

export async function countRawMetaInsights(tenantId: string): Promise<number> {
  return withTenant(tenantId, async (tx) => {
    const [row] = await tx.select({ n: count() }).from(rawMetaInsights);
    return row?.n ?? 0;
  });
}
