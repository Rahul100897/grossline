// Assemble a ReportModel for a tenant + month from the metric layer, findings,
// and honesty markers (docs/phase-5.md task B1). Read-only selection — no metric
// is computed here. The returned model IS the report snapshot (task B3 persists
// it), so everything the report says is captured as a value, never re-queried at
// render time.
import {
  renderTemplate,
  classifyRecommendation,
  minorUnitExponent,
  type CommentaryFinding,
} from '@grossline/core';
import {
  compareMetric,
  getMetricValues,
  getTenant,
  listConnections,
  listFindings,
  listMetricPeriods,
  type Finding,
  type MetricComparison,
} from '@grossline/db';
import { loadMetricBundle, type MetricBundle } from '../findings/metric-bundle';
import { thresholdsFor } from '../findings/calibrate';
import type {
  ChangeRow,
  ChannelRow,
  CheckOutcome,
  Direction,
  ReportFinding,
  ReportFindingKind,
  ReportModel,
  WaterfallRow,
} from './report-html';

const MONTH_NAMES = [
  'January',
  'February',
  'March',
  'April',
  'May',
  'June',
  'July',
  'August',
  'September',
  'October',
  'November',
  'December',
];

function periodLabel(period: string): string {
  const [y, m] = period.split('-');
  return `${MONTH_NAMES[Number(m) - 1]} ${y}`;
}

function priorPeriodOf(period: string): string {
  const d = new Date(`${period}T00:00:00Z`);
  return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() - 1, 1)).toISOString().slice(0, 10);
}

function money(minor: number | null, currency: string): string {
  if (minor === null) return '—';
  const exp = minorUnitExponent(currency);
  return `${currency} ${(minor / 10 ** exp).toLocaleString('en-US', { minimumFractionDigits: exp, maximumFractionDigits: exp })}`;
}

const CHECK_LABEL: Record<string, string> = {
  mer: 'blended MER against break-even',
  blended_cac: 'blended CAC against first-order contribution',
  discount_share: 'discount share of gross sales',
  spend_projected_month_end: 'projected month-end spend against target',
  ad_spend: 'spend on this campaign',
  branded_search_share: 'branded share of Google spend',
  search_term_cost: 'wasted search-term cost',
  refund_rate: 'this product’s refund rate',
  claim_gap: 'the platform-to-store claim gap',
  platform_roas: 'the campaign’s platform-reported ROAS (platform-reported)',
};

const MONEY_CHECK = new Set([
  'blended_cac',
  'spend_projected_month_end',
  'ad_spend',
  'search_term_cost',
]);
const RATE_CHECK = new Set(['claim_gap', 'discount_share', 'branded_search_share', 'refund_rate']);

const RULE_TITLES: Record<string, string> = {
  below_break_even_mer: 'Below break-even MER',
  dead_campaign: 'Dead campaign',
  branded_search_share: 'Branded search share',
  search_term_waste: 'Search term waste',
  discount_leakage: 'Discount leakage',
  refund_outlier: 'Refund outlier',
  payback_broken: 'Payback broken',
  claim_gap: 'Claim gap',
  spend_pacing: 'Spend pacing',
  spend_headroom: 'Spend headroom',
  scale_signal: 'Scale signal',
};

function tenantVal(bundle: MetricBundle, metric: string): number | null {
  return bundle.tenant(metric)?.value ?? null;
}

/** Delta rendered in the metric's own units (money / points / ratio). */
function formatDeltaFor(
  kind: 'money' | 'rate' | 'ratio',
  cmp: MetricComparison,
  currency: string,
): string | null {
  if (cmp.delta === null) return null;
  const sign = cmp.delta > 0 ? '+' : cmp.delta < 0 ? '−' : '';
  const abs = Math.abs(cmp.delta);
  if (kind === 'money') return `${sign}${money(Math.round(abs), currency)}`;
  if (kind === 'rate') return `${sign}${(abs * 100).toFixed(1)} pts`;
  return `${sign}${abs.toFixed(2)}`;
}

function formatCurrent(
  kind: 'money' | 'rate' | 'ratio',
  value: number | null,
  currency: string,
): string {
  if (value === null) return '—';
  if (kind === 'money') return money(value, currency);
  if (kind === 'rate') return `${(value * 100).toFixed(1)}%`;
  return value.toFixed(2);
}

function findingKind(f: Finding): ReportFindingKind {
  return f.family === 'growth' ? 'growth' : f.family === 'measurement' ? 'measurement' : 'waste';
}

function findingValueLabel(f: Finding, currency: string): string {
  if (f.family === 'growth') {
    return f.opportunityValueMinor === null
      ? 'opportunity'
      : `+${money(f.opportunityValueMinor, currency)} opportunity`;
  }
  if (f.family === 'measurement') return 'no money at stake';
  return `${money(f.moneyImpactMinor, currency)} at stake`;
}

function toCommentary(f: Finding): CommentaryFinding {
  return {
    ruleId: f.ruleId,
    entityLabel: f.entityLabel,
    currency: f.currency ?? 'USD',
    status: f.status,
    occurrenceCount: f.occurrenceCount,
    moneyImpactMinor: f.moneyImpactMinor,
    currentValue: f.currentValue === null ? null : Number(f.currentValue),
    comparisonValue: f.comparisonValue === null ? null : Number(f.comparisonValue),
    delta: f.delta === null ? null : Number(f.delta),
    evidence: (f.evidence ?? {}) as CommentaryFinding['evidence'],
    checkMetric: f.checkMetric,
    family: f.family as CommentaryFinding['family'],
    opportunityValueMinor: f.opportunityValueMinor,
  };
}

function findingText(f: Finding): string {
  return f.finalText ?? f.draftText ?? renderTemplate(toCommentary(f)).text;
}

function scopeFor(f: Finding): string {
  if (f.entity === 'account') return '';
  if (f.ruleId === 'claim_gap') return `platform:${f.entityKey.split(':')[1] ?? ''}`;
  return f.entityKey;
}

export type BuildReportOptions = {
  /** Override the approved-set gate for previews (task B4 passes the real set). */
  includeUnapproved?: boolean;
  freeReport?: { periodLabel: string; priceText: string } | null;
  lastReconciledAt?: string | null;
};

export async function buildReportModel(
  tenantId: string,
  period: string,
  opts: BuildReportOptions = {},
): Promise<ReportModel> {
  const tenant = await getTenant(tenantId);
  if (!tenant) throw new Error(`tenant not found: ${tenantId}`);
  const currency = tenant.reportingCurrency;

  // Trial tenants get a footer stating this report is free and the price after
  // (task 5.B7). An explicit opts.freeReport overrides.
  const freeReport =
    opts.freeReport !== undefined
      ? opts.freeReport
      : tenant.status === 'trial'
        ? {
            periodLabel: periodLabel(period),
            priceText:
              tenant.monthlyFeeMinor !== null
                ? `${money(tenant.monthlyFeeMinor, tenant.feeCurrency)} / month`
                : 'the plan price',
          }
        : null;

  const [bundle, thresholds, connections, allFindings, metricPeriods] = await Promise.all([
    loadMetricBundle(tenantId, period),
    thresholdsFor(tenantId),
    listConnections(tenantId),
    listFindings(tenantId, { period, includeSuppressed: false }),
    listMetricPeriods(tenantId, 'month'),
  ]);

  // ---- honesty markers ----
  const lastSyncedAt = connections
    .map((c) => c.lastSuccessAt)
    .filter((d): d is Date => d instanceof Date)
    .sort((a, b) => b.getTime() - a.getTime())[0];
  const marginMeta = (bundle.tenant('contribution_after_ad_spend')?.meta ??
    bundle.tenant('cogs')?.meta ??
    {}) as Record<string, unknown>;
  const costCompleteness =
    typeof marginMeta.completeness === 'number' ? marginMeta.completeness : null;
  const netMeta = (bundle.tenant('net_sales')?.meta ?? {}) as Record<string, unknown>;
  const provisional = netMeta.provisional === true;

  // ---- headline (contribution + direction) ----
  const contribution = tenantVal(bundle, 'contribution_after_ad_spend');
  const contribCmp = await compareMetric(tenantId, {
    metric: 'contribution_after_ad_spend',
    period,
    kind: 'previous_period',
  });
  const direction: Direction | null =
    contribCmp.delta === null
      ? null
      : contribCmp.delta > 0
        ? 'up'
        : contribCmp.delta < 0
          ? 'down'
          : 'flat';
  const mer = tenantVal(bundle, 'mer');
  const breakEvenMer = thresholds.breakEvenMer;
  const worked =
    mer !== null && breakEvenMer !== null
      ? mer >= breakEvenMer
      : contribution !== null && contribution >= 0;
  const dirWord =
    direction === 'up'
      ? 'up on last month'
      : direction === 'down'
        ? 'down on last month'
        : direction === 'flat'
          ? 'level with last month'
          : 'with no prior month to compare';
  const headlineSentence =
    contribution === null
      ? `${periodLabel(period)}: contribution after ad spend is not yet computable for this period.`
      : `${periodLabel(period)} ${worked ? 'worked' : 'was under pressure'} — ${money(contribution, currency)} of contribution after ad spend, ${dirWord}.`;

  // ---- margin waterfall ----
  const neg = (v: number | null): number | null => (v === null ? null : -v);
  const marginRows: WaterfallRow[] = [
    { label: 'Gross sales', amountMinor: tenantVal(bundle, 'gross_sales') },
    { label: 'Discounts', amountMinor: neg(tenantVal(bundle, 'discounts')) },
    { label: 'Returns', amountMinor: neg(tenantVal(bundle, 'returns')) },
    { label: 'Net sales', amountMinor: tenantVal(bundle, 'net_sales'), kind: 'subtotal' },
    { label: 'Cost of goods', amountMinor: neg(tenantVal(bundle, 'cogs')) },
    { label: 'Gross profit', amountMinor: tenantVal(bundle, 'gross_profit'), kind: 'subtotal' },
    { label: 'Ad spend', amountMinor: neg(tenantVal(bundle, 'total_ad_spend')) },
    { label: 'Contribution after ad spend', amountMinor: contribution, kind: 'total' },
  ];

  // ---- channel + claim gap ----
  const claimScopes = bundle.scoped('claim_gap').filter((m) => m.scope.startsWith('platform:'));
  const channels: ChannelRow[] = claimScopes.map((m) => {
    const platform = m.scope.split(':')[1] ?? 'unknown';
    const conversions = bundle.at('platform_conversions', `platform:${platform}`)?.value ?? null;
    const spend = bundle.at('ad_spend', `platform:${platform}`)?.value ?? null;
    return {
      label: platform === 'google_ads' ? 'Google Ads' : platform === 'meta' ? 'Meta' : platform,
      spendMinor: spend,
      platformConversions: conversions,
      storeOrders: conversions === null ? null : Math.round(conversions * (1 - m.value)),
      claimGap: m.value,
    };
  });

  // ---- what changed (MoM + YoY on the headline metrics) ----
  const changeSpecs: { metric: string; label: string; kind: 'money' | 'rate' | 'ratio' }[] = [
    { metric: 'net_sales', label: 'Net sales', kind: 'money' },
    { metric: 'contribution_after_ad_spend', label: 'Contribution after ad spend', kind: 'money' },
    { metric: 'mer', label: 'Blended MER', kind: 'ratio' },
    { metric: 'blended_cac', label: 'Blended CAC', kind: 'money' },
    { metric: 'order_count', label: 'Orders', kind: 'ratio' },
  ];
  const whatChanged: ChangeRow[] = await Promise.all(
    changeSpecs.map(async (s) => {
      const [mom, yoy] = await Promise.all([
        compareMetric(tenantId, { metric: s.metric, period, kind: 'previous_period' }),
        compareMetric(tenantId, { metric: s.metric, period, kind: 'year_over_year' }),
      ]);
      return {
        label: s.label,
        current: formatCurrent(s.kind, mom.current, currency),
        mom: formatDeltaFor(s.kind, mom, currency),
        yoy: formatDeltaFor(s.kind, yoy, currency),
      };
    }),
  );

  // ---- findings (the approved / sendable set) + measurement ----
  const sendable = allFindings.filter(
    (f) =>
      (opts.includeUnapproved || f.approvedAt !== null) &&
      (f.status === 'new' || f.status === 'recurring'),
  );
  const findings: ReportFinding[] = sendable.map((f) => ({
    title: RULE_TITLES[f.ruleId] ?? f.ruleId,
    entityLabel: f.entityLabel,
    family: findingKind(f),
    valueLabel: findingValueLabel(f, currency),
    text: findingText(f),
  }));
  const nothingNeedsChanging = findings.every((f) => f.family === 'measurement');

  // ---- checks (this month's carried checks + last month's outcomes) ----
  const checksThisMonth = sendable
    .filter((f) => f.checkMetric !== null && f.family !== 'measurement')
    .map((f) => CHECK_LABEL[f.checkMetric as string] ?? (f.checkMetric as string));

  const priorPeriod = priorPeriodOf(period);
  const priorApproved = (
    await listFindings(tenantId, { period: priorPeriod, includeSuppressed: false })
  ).filter((f) => f.approvedAt !== null && f.checkMetric !== null);
  const nextComputed = metricPeriods.includes(period);
  const lastMonthOutcomes: CheckOutcome[] = await Promise.all(
    priorApproved.map(async (f) => {
      let measured: number | null = null;
      if (nextComputed && f.checkMetric) {
        const rows = await getMetricValues(tenantId, {
          metric: f.checkMetric,
          grain: 'month',
          periods: [period],
          scope: scopeFor(f),
        });
        measured = rows[0] ? Number(rows[0].value) : null;
      }
      const nextFinding = allFindings.find(
        (x) => x.ruleId === f.ruleId && x.entityKey === f.entityKey,
      );
      const resolvedNextPeriod =
        nextComputed && (nextFinding === undefined || nextFinding.status === 'resolved');
      const baseline = f.checkBaseline === null ? null : Number(f.checkBaseline);
      const judge = classifyRecommendation({
        checkMetric: f.checkMetric,
        baseline,
        measured,
        resolvedNextPeriod,
        computedNextPeriod: nextComputed,
        family: f.family as CommentaryFinding['family'],
      });
      const fmt = (v: number | null): string =>
        v === null
          ? '—'
          : MONEY_CHECK.has(f.checkMetric as string)
            ? money(v, currency)
            : RATE_CHECK.has(f.checkMetric as string)
              ? `${(v * 100).toFixed(1)}%`
              : v.toFixed(2);
      const result =
        judge.status === 'pending'
          ? 'awaiting this month'
          : judge.status === 'resolved'
            ? `resolved — ${f.checkMetric} now ${fmt(measured)}`
            : `${f.checkMetric} ${fmt(baseline)} → ${fmt(measured)}`;
      return {
        label: `${RULE_TITLES[f.ruleId] ?? f.ruleId} · ${f.entityLabel}`,
        result,
        status: judge.status,
      };
    }),
  );

  return {
    tenantName: tenant.name,
    brandText: null,
    currency,
    period,
    periodLabel: periodLabel(period),
    generatedAt: new Date().toISOString(),
    honesty: {
      reportingCurrency: currency,
      reportingTimezone: tenant.reportingTimezone,
      lastSyncedAt: lastSyncedAt ? lastSyncedAt.toISOString() : null,
      lastReconciledAt: opts.lastReconciledAt ?? null,
      provisional,
      costCompleteness,
      costProvenance: null,
    },
    headline: { sentence: headlineSentence, contributionMinor: contribution, direction },
    efficiency: {
      merValue: mer,
      breakEvenMer,
      targetMer: null,
      blendedCacMinor: tenantVal(bundle, 'blended_cac'),
      firstOrderContributionMinor: tenantVal(bundle, 'first_order_contribution'),
    },
    margin: { rows: marginRows, completeness: costCompleteness },
    channels,
    whatChanged,
    findings,
    nothingNeedsChanging,
    checksThisMonth,
    lastMonthOutcomes,
    freeReport,
  };
}
