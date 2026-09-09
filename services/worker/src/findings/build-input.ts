// Build the typed FindingsInput for a tenant and month from the metric layer
// (docs/phase-4.md). Selection only — no metric is computed here; every number
// comes from stored metric_values or cost inputs. Where the metric layer does
// not (yet) provide something a rule needs — per-campaign order attribution,
// search-term reports, per-product refunds — the availability flag is false and
// the dependent rule skips rather than firing on nothing.
import type { CampaignFact, ChannelClaimFact, FindingsInput, FindingThresholds } from '@grossline/core';
import {
  getCostInputsEffectiveOn,
  listConnections,
  type Connection,
} from '@grossline/db';
import { loadMetricBundle, type MetricBundle } from './metric-bundle';

/** First day of the previous calendar month for a YYYY-MM-01 period. */
function priorPeriodOf(period: string): string {
  const d = new Date(`${period}T00:00:00Z`);
  return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() - 1, 1)).toISOString().slice(0, 10);
}

/** Last day of the month for a YYYY-MM-01 period (cost inputs are effective-dated). */
function monthEnd(period: string): string {
  const d = new Date(`${period}T00:00:00Z`);
  return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + 1, 0)).toISOString().slice(0, 10);
}

function platformFromScope(scope: string): string {
  // 'campaign:google_ads:123' → 'google_ads'; 'platform:meta' → 'meta'.
  const parts = scope.split(':');
  return parts[1] ?? 'unknown';
}

function campaignsFrom(bundle: MetricBundle): CampaignFact[] {
  return bundle
    .scoped('ad_spend')
    .filter((m) => m.scope.startsWith('campaign:'))
    .map((m) => {
      const name = typeof m.meta.campaignName === 'string' ? m.meta.campaignName : null;
      return {
        key: m.scope,
        label: name ?? m.scope,
        platform: platformFromScope(m.scope),
        spendMinor: m.value,
        // The metric layer does not attribute orders to ad campaigns yet.
        attributedOrders: null,
        // Branded only identifiable when a campaign name is present.
        isBranded: name === null ? null : /brand/i.test(name),
        // Platform-reported ROAS is computed at campaign scope by the ad-platform
        // metric layer; null when absent (used by the scale-signal growth rule).
        roas: bundle.at('platform_roas', m.scope)?.value ?? null,
      };
    });
}

function channelClaimsFrom(bundle: MetricBundle): ChannelClaimFact[] {
  return bundle
    .scoped('claim_gap')
    .filter((m) => m.scope.startsWith('platform:'))
    .map((m) => {
      const platform = platformFromScope(m.scope);
      const conversions = bundle.at('platform_conversions', `platform:${platform}`)?.value ?? 0;
      const spend = bundle.at('ad_spend', `platform:${platform}`)?.value ?? 0;
      return {
        platform,
        label: platform === 'google_ads' ? 'Google Ads' : platform === 'meta' ? 'Meta' : platform,
        claimGap: m.value,
        platformConversions: conversions,
        storeOrders: Math.round(conversions * (1 - m.value)),
        spendMinor: spend,
      };
    });
}

export async function buildFindingsInput(
  tenantId: string,
  period: string,
  currency: string,
  thresholds: FindingThresholds,
): Promise<FindingsInput> {
  const [bundle, prior, connections, costInputs] = await Promise.all([
    loadMetricBundle(tenantId, period),
    loadMetricBundle(tenantId, priorPeriodOf(period)),
    listConnections(tenantId),
    getCostInputsEffectiveOn(tenantId, monthEnd(period)),
  ]);

  const tenantVal = (metric: string): number | null => bundle.tenant(metric)?.value ?? null;

  const gross = tenantVal('gross_sales');
  const discounts = tenantVal('discounts');
  const priorGross = prior.tenant('gross_sales')?.value ?? null;
  const priorDiscounts = prior.tenant('discounts')?.value ?? null;
  const priorDiscountShare =
    priorGross !== null && priorGross !== 0 && priorDiscounts !== null ? priorDiscounts / priorGross : null;

  const isDemo = (c: Connection): boolean =>
    ((c.settings ?? {}) as Record<string, unknown>).demo === true;
  const realConns = connections.filter((c) => !isDemo(c));
  const hasGoogle =
    realConns.some((c) => c.provider === 'google_ads') || bundle.at('ad_spend', 'platform:google_ads') !== null;
  const hasMeta = realConns.some((c) => c.provider === 'meta') || bundle.at('ad_spend', 'platform:meta') !== null;

  const campaigns = campaignsFrom(bundle);
  const channelClaims = channelClaimsFrom(bundle);

  const monthlySpendTargetMinor = costInputs?.monthlySpendTargetMinor ?? null;
  // Margin is present when the break-even ROAS (contribution-margin-derived) exists.
  const hasMargin = bundle.tenant('break_even_roas') !== null && thresholds.breakEvenMer !== null;

  return {
    period,
    currency,
    account: {
      currency,
      merValue: tenantVal('mer'),
      netSalesMinor: tenantVal('net_sales'),
      totalAdSpendMinor: tenantVal('total_ad_spend'),
      grossSalesMinor: gross,
      discountsMinor: discounts,
      blendedCacMinor: tenantVal('blended_cac'),
      firstOrderContributionMinor: tenantVal('first_order_contribution'),
      newCustomerCount: tenantVal('new_customer_count'),
      refundRate: tenantVal('refund_rate'),
      spendMonthToDateMinor: tenantVal('spend_month_to_date'),
      spendProjectedMonthEndMinor: tenantVal('spend_projected_month_end'),
    },
    priorDiscountShare,
    campaigns,
    searchTerms: [], // no search-term report in the metric layer yet
    productRefunds: [], // no per-product refund metric yet
    channelClaims,
    monthlySpendTargetMinor,
    thresholds,
    availability: {
      hasMargin,
      hasGoogle,
      hasMeta,
      // Per-campaign order attribution and branded classification are not yet
      // computed; a campaign name (rare) enables branded classification only.
      hasCampaignAttribution: campaigns.some((c) => c.attributedOrders !== null),
      hasBrandedClassification: hasGoogle && campaigns.some((c) => c.platform === 'google_ads' && c.isBranded !== null),
      hasSearchTerms: false,
      hasProductRefunds: false,
      hasSpendTarget: monthlySpendTargetMinor !== null,
    },
  };
}
