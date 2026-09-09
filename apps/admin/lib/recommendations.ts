// Recommendation history assembly (docs/phase-4.md task 4.7). Every approved
// finding with a check-metric becomes a recommendation; the next period's value
// of that metric is the measured result and the pure classifier decides the
// status. Read-only over findings + metric_values.
import {
  classifyRecommendation,
  type RecStatus,
} from '@grossline/core';
import { getMetricValues, listFindings, listMetricPeriods, type Finding } from '@grossline/db';
import { formatMinor, formatPct, formatRatio } from './format';
import { ruleTitle } from './findings';

/** Check metrics measured in money (else a rate/ratio). */
const MONEY_CHECK = new Set(['blended_cac', 'spend_projected_month_end', 'ad_spend', 'search_term_cost']);
const RATE_CHECK = new Set(['claim_gap', 'discount_share', 'branded_search_share', 'refund_rate']);

export type Recommendation = {
  id: string;
  ruleId: string;
  title: string;
  entityLabel: string;
  period: string;
  checkMetric: string | null;
  baseline: number | null;
  measured: number | null;
  status: RecStatus;
  actioned: boolean | null;
  resultText: string;
};

function addMonth(period: string): string {
  const d = new Date(`${period}T00:00:00Z`);
  return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + 1, 1)).toISOString().slice(0, 10);
}

/** The metric scope to read the check value at: account '' , claim platform:*, else the entity key. */
function scopeFor(f: Finding): string {
  if (f.entity === 'account') return '';
  if (f.ruleId === 'claim_gap') return `platform:${f.entityKey.split(':')[1] ?? ''}`;
  return f.entityKey;
}

function formatCheck(value: number | null, checkMetric: string | null, currency: string): string {
  if (value === null) return '—';
  if (checkMetric && MONEY_CHECK.has(checkMetric)) return formatMinor(value, currency) ?? '—';
  if (checkMetric && RATE_CHECK.has(checkMetric)) return formatPct(value) ?? '—';
  return formatRatio(value) ?? String(value);
}

export async function buildRecommendationHistory(
  tenantId: string,
  currency: string,
): Promise<Recommendation[]> {
  const [findings, metricPeriods] = await Promise.all([
    listFindings(tenantId, { includeSuppressed: true }),
    listMetricPeriods(tenantId, 'month'),
  ]);
  const byKeyPeriod = new Map<string, Finding>(
    findings.map((f) => [`${f.ruleId} ${f.entityKey} ${f.period}`, f]),
  );
  const approved = findings
    .filter((f) => f.approvedAt !== null && f.checkMetric !== null)
    .sort((a, b) => (a.period < b.period ? 1 : a.period > b.period ? -1 : 0));

  const out: Recommendation[] = [];
  for (const a of approved) {
    const nextPeriod = addMonth(a.period);
    const computedNextPeriod = metricPeriods.includes(nextPeriod);
    const nextFinding = byKeyPeriod.get(`${a.ruleId} ${a.entityKey} ${nextPeriod}`);
    const resolvedNextPeriod =
      computedNextPeriod && (nextFinding === undefined || nextFinding.status === 'resolved');

    let measured: number | null = null;
    if (computedNextPeriod && a.checkMetric) {
      const rows = await getMetricValues(tenantId, {
        metric: a.checkMetric,
        grain: 'month',
        periods: [nextPeriod],
        scope: scopeFor(a),
      });
      measured = rows[0] ? Number(rows[0].value) : null;
    }
    const baseline = a.checkBaseline === null ? null : Number(a.checkBaseline);
    const judge = classifyRecommendation({
      checkMetric: a.checkMetric,
      baseline,
      measured,
      resolvedNextPeriod,
      computedNextPeriod,
      family: a.family,
    });

    const b = formatCheck(baseline, a.checkMetric, currency);
    const m = formatCheck(measured, a.checkMetric, currency);
    let resultText: string;
    if (judge.status === 'pending') resultText = 'awaiting next month';
    else if (judge.status === 'resolved') resultText = measured !== null ? `resolved — ${a.checkMetric} now ${m}` : 'resolved';
    else if (a.family === 'growth' && judge.status === 'worsened')
      // A growth bet that was tried and did not hold — a genuine report line.
      resultText = `tried — ${a.checkMetric} ${b} → ${m}, would revert`;
    else if (a.family === 'growth' && judge.status === 'improving')
      resultText = `${a.checkMetric} ${b} → ${m}, held`;
    else resultText = `${a.checkMetric} ${b} → ${m}`;

    out.push({
      id: a.id,
      ruleId: a.ruleId,
      title: ruleTitle(a.ruleId),
      entityLabel: a.entityLabel,
      period: a.period,
      checkMetric: a.checkMetric,
      baseline,
      measured,
      status: judge.status,
      actioned: judge.actioned,
      resultText,
    });
  }
  return out;
}
