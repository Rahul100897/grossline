// Golden tests for task 2.6 (ad platform metrics). Expected values are
// HAND-CALCULATED from the synthetic Meta/Google fixtures (February 2026):
//
// META platform totals (ACCOUNT-level rows — Meta's own totals):
//   spend  168.60 + 128.05 + 0.00        = 296.65 → 29665
//   impr   16104 + 10974 + 0             = 27078
//   clicks 437 + 305 + 0                 = 742
//   conv   12 + 6                        = 18
//   value  1005.30 + 521.90              = 1527.20 → 152720
//   cpm  round(29665×1000/27078) = 1096; cpc round(29665/742) = 40
//   ctr  742/27078 ≈ 0.027402; roas 152720/29665 ≈ 5.148154
//
// META campaign prospecting-q1 (…001):
//   spend 132.40+128.05+120.50 = 380.95 → 38095; impr 33299; clicks 958;
//   conv 8+6+9 = 23; value 704.20+521.90+812.40 = 2038.50 → 203850
//
// GOOGLE platform totals (campaign-row sums — Google's total IS that sum):
//   search-brand:  cost 48210000+5193000+47750000 µ = 4821+519+4775 = 10115
//                  impr 5684; clicks 652; conv 32.5; value 2735.20 → 273520
//   pmax:          cost 89340000+0+91020000 µ = 8934+0+9102 = 18036
//                  impr 86983; clicks 2454; conv 5; value 237.20 → 23720
//   platform: spend 28151; impr 92667; clicks 3106; conv 37.5; value 297240
//   cpm round(28151×1000/92667) = 304; cpc round(28151/3106) = 9
//
// PACING: total spend 29665+28151 = 57816; Feb 2026 is closed → projection
// equals actual; target set to 6,000,000 minor ($60k).
import { randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  closeDbPools,
  createConnection,
  createTenant,
  getMetricValues,
  upsertRawGoogleAdsInsights,
  upsertRawMetaInsights,
  upsertTenantCostInputs,
  withTenant,
  schema,
  type MetaInsightRow,
} from '@grossline/db';
import { and, eq, inArray } from 'drizzle-orm';
import { computeMetricsForMonth } from '../src/metrics/pipeline';

const fixturesDir = join(dirname(fileURLToPath(import.meta.url)), 'fixtures');
const fixture = (rel: string) => JSON.parse(readFileSync(join(fixturesDir, rel), 'utf8'));

let tenantId: string;

async function value(metric: string, scope: string): Promise<{ value: number; meta: unknown }> {
  const rows = await getMetricValues(tenantId, {
    metric,
    grain: 'month',
    periods: ['2026-02-01'],
    scope,
  });
  expect(rows, `${metric} ${scope}`).toHaveLength(1);
  return { value: Number(rows[0]!.value), meta: rows[0]!.meta };
}

beforeAll(async () => {
  tenantId = (
    await createTenant({
      name: 'Ad metrics tenant',
      slug: `ads-${randomUUID().slice(0, 8)}`,
      reportingCurrency: 'USD',
      reportingTimezone: 'America/New_York',
    })
  ).id;
  const metaConn = await createConnection({
    tenantId,
    provider: 'meta',
    externalAccountId: 'act_ads_test',
    accountCurrency: 'USD',
  });
  const googleConn = await createConnection({
    tenantId,
    provider: 'google_ads',
    externalAccountId: '9876543210',
    accountCurrency: 'USD',
  });

  const metaRows: MetaInsightRow[] = [];
  for (const file of [
    'meta/synthetic-insights-campaign-page1.json',
    'meta/synthetic-insights-campaign-page2.json',
  ]) {
    for (const row of fixture(file).data) {
      metaRows.push({
        adAccountId: 'act_ads_test',
        level: 'campaign',
        campaignId: row.campaign_id,
        date: row.date_start,
        payload: row,
      });
    }
  }
  for (const row of fixture('meta/synthetic-insights-account.json').data) {
    metaRows.push({ adAccountId: 'act_ads_test', level: 'account', campaignId: '', date: row.date_start, payload: row });
  }
  await upsertRawMetaInsights(tenantId, metaConn.id, metaRows);

  const googleResults = fixture('google-ads/synthetic-searchstream-campaigns.json')[0].results;
  await upsertRawGoogleAdsInsights(
    tenantId,
    googleConn.id,
    googleResults.map((r: { campaign: { id: string }; segments: { date: string } }) => ({
      customerId: '9876543210',
      campaignId: String(r.campaign.id),
      date: r.segments.date,
      payload: r,
    })),
  );

  await upsertTenantCostInputs(tenantId, {
    effectiveFrom: '2026-01-01',
    currency: 'USD',
    monthlySpendTargetMinor: 6_000_000,
  });

  await computeMetricsForMonth(tenantId, 2026, 2);
});

afterAll(async () => {
  await closeDbPools();
});

describe('platform totals match the raw tables exactly', () => {
  it('meta (from its own account-level rows)', async () => {
    expect((await value('ad_spend', 'platform:meta')).value).toBe(29665);
    expect((await value('ad_impressions', 'platform:meta')).value).toBe(27078);
    expect((await value('ad_clicks', 'platform:meta')).value).toBe(742);
    expect((await value('platform_conversions', 'platform:meta')).value).toBe(18);
    expect((await value('platform_conversion_value', 'platform:meta')).value).toBe(152720);
    expect((await value('ad_cpm', 'platform:meta')).value).toBe(1096);
    expect((await value('ad_cpc', 'platform:meta')).value).toBe(40);
    expect((await value('ad_ctr', 'platform:meta')).value).toBeCloseTo(0.027402, 5);
    expect((await value('platform_roas', 'platform:meta')).value).toBeCloseTo(5.148154, 4);
  });

  it('google (campaign sums — its total is that sum)', async () => {
    expect((await value('ad_spend', 'platform:google_ads')).value).toBe(28151);
    expect((await value('ad_impressions', 'platform:google_ads')).value).toBe(92667);
    expect((await value('ad_clicks', 'platform:google_ads')).value).toBe(3106);
    expect((await value('platform_conversions', 'platform:google_ads')).value).toBe(37.5);
    expect((await value('platform_conversion_value', 'platform:google_ads')).value).toBe(297240);
    expect((await value('ad_cpm', 'platform:google_ads')).value).toBe(304);
    expect((await value('ad_cpc', 'platform:google_ads')).value).toBe(9);
  });

  it('per campaign', async () => {
    const prospecting = 'campaign:meta:120210000000000001';
    expect((await value('ad_spend', prospecting)).value).toBe(38095);
    expect((await value('platform_conversions', prospecting)).value).toBe(23);
    expect((await value('platform_conversion_value', prospecting)).value).toBe(203850);
    expect((await value('platform_roas', prospecting)).value).toBeCloseTo(5.351096, 4);

    expect((await value('ad_spend', 'campaign:google_ads:22222222221')).value).toBe(10115);
    expect((await value('ad_spend', 'campaign:google_ads:22222222222')).value).toBe(18036);
    expect((await value('platform_conversion_value', 'campaign:google_ads:22222222222')).value).toBe(23720);
  });
});

describe('platform-reported figures never blend', () => {
  it('has NO tenant-level (scope "") row for any platform-reported metric', async () => {
    const rows = await withTenant(tenantId, (tx) =>
      tx
        .select()
        .from(schema.metricValues)
        .where(
          and(
            inArray(schema.metricValues.metric, [
              'platform_conversions',
              'platform_conversion_value',
              'platform_roas',
            ]),
            eq(schema.metricValues.scope, ''),
          ),
        ),
    );
    expect(rows).toHaveLength(0);
  });

  it('labels every platform metric as platform-reported, ROAS as reference-only', async () => {
    const roas = await value('platform_roas', 'platform:meta');
    expect(roas.meta).toMatchObject({ platformReported: true, referenceOnly: true, neverBlended: true });
  });
});

describe('budget pacing', () => {
  it('reports spend to date and projection with the target attached', async () => {
    const mtd = await value('spend_month_to_date', '');
    expect(mtd.value).toBe(57816); // 29665 + 28151
    expect(mtd.meta).toMatchObject({ monthClosed: true, targetMinor: 6_000_000 });
    const projected = await value('spend_projected_month_end', '');
    expect(projected.value).toBe(57816); // closed month: projection is the actual
  });
});
