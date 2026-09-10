// Weekly digest (docs/phase-5.md task B5). Five numbers over the trailing seven
// days plus anything flagged since the last digest — plain text, no attachment.
// Monthly reports are always slightly too late; this catches a spend problem in
// days. The text builder and the schedule check are pure; the assembly reads the
// daily metric layer and recent findings.
import { minorUnitExponent, logger } from '@grossline/core';
import {
  getMetricValues,
  getSettings,
  getTenant,
  listFindings,
  listTenants,
} from '@grossline/db';
import { sendEmail, type SendResult } from '../email';

export type DigestConfig = {
  enabled: boolean;
  defaultDay: number; // 0=Sun … 6=Sat
  days: Record<string, number>;
};

/** The weekday the digest sends for a tenant (per-tenant override else default). */
export function resolveDigestDay(config: DigestConfig, tenantId: string): number {
  return config.days[tenantId] ?? config.defaultDay;
}

/** Whether `date` (UTC) is this tenant's digest day and digests are enabled. */
export function isDigestDay(config: DigestConfig, tenantId: string, date: Date): boolean {
  if (!config.enabled) return false;
  return date.getUTCDay() === resolveDigestDay(config, tenantId);
}

export type DigestNumbers = {
  netSalesMinor: number;
  adSpendMinor: number;
  mer: number | null;
  orders: number;
  aovMinor: number | null;
};

export type DigestInput = {
  tenantName: string;
  currency: string;
  windowStart: string; // YYYY-MM-DD
  windowEnd: string; // YYYY-MM-DD
  numbers: DigestNumbers;
  flags: string[]; // findings surfaced since the last digest
};

function money(minor: number | null, currency: string): string {
  if (minor === null) return '—';
  const exp = minorUnitExponent(currency);
  return `${currency} ${(minor / 10 ** exp).toLocaleString('en-US', { minimumFractionDigits: exp, maximumFractionDigits: exp })}`;
}

/** The plain-text digest email body. Deterministic; golden-tested. */
export function buildDigestText(input: DigestInput): string {
  const n = input.numbers;
  const c = input.currency;
  const lines: string[] = [
    `${input.tenantName} — weekly digest`,
    `Last 7 days (${input.windowStart} to ${input.windowEnd})`,
    '',
    `  Net sales:   ${money(n.netSalesMinor, c)}`,
    `  Ad spend:    ${money(n.adSpendMinor, c)}`,
    `  MER:         ${n.mer === null ? '—' : n.mer.toFixed(2)}`,
    `  Orders:      ${n.orders.toLocaleString('en-US')}`,
    `  AOV:         ${money(n.aovMinor, c)}`,
    '',
  ];
  if (input.flags.length === 0) {
    lines.push('Flagged since the last digest: nothing new.');
  } else {
    lines.push('Flagged since the last digest:');
    for (const f of input.flags) lines.push(`  • ${f}`);
  }
  lines.push('', 'The full monthly report follows at month end.');
  return lines.join('\n');
}

// ---- assembly from the metric layer + findings ----

function dateLabels(end: string, days: number): string[] {
  const out: string[] = [];
  const d = new Date(`${end}T00:00:00Z`);
  for (let i = 0; i < days; i += 1) {
    out.push(new Date(d.getTime() - i * 86_400_000).toISOString().slice(0, 10));
  }
  return out.reverse();
}

async function sumDaily(tenantId: string, metric: string, periods: string[], scope = ''): Promise<number> {
  const rows = await getMetricValues(tenantId, { metric, grain: 'day', periods, scope });
  return rows.reduce((s, r) => s + Number(r.value), 0);
}

const RULE_TITLES: Record<string, string> = {
  below_break_even_mer: 'Below break-even MER',
  payback_broken: 'Payback broken',
  discount_leakage: 'Discount leakage',
  spend_pacing: 'Spend pacing',
  claim_gap: 'Claim gap',
  spend_headroom: 'Spend headroom',
  scale_signal: 'Scale signal',
  dead_campaign: 'Dead campaign',
  branded_search_share: 'Branded search share',
  search_term_waste: 'Search term waste',
  refund_outlier: 'Refund outlier',
};

export type WeeklyDigest = { input: DigestInput; text: string; hasContent: boolean };

/**
 * Build the digest for a tenant as of `asOf` (inclusive end of the 7-day window).
 * Ad spend sums the platform-scoped daily ad_spend; findings flagged in the
 * window are those created within it (a simple, stateless "since last digest").
 */
export async function buildWeeklyDigest(tenantId: string, asOf: string): Promise<WeeklyDigest> {
  const tenant = await getTenant(tenantId);
  if (!tenant) throw new Error(`tenant not found: ${tenantId}`);
  const currency = tenant.reportingCurrency;
  const periods = dateLabels(asOf, 7);
  const windowStart = periods[0]!;
  const windowEnd = periods[periods.length - 1]!;

  const [netSalesMinor, orders, googleSpend, metaSpend] = await Promise.all([
    sumDaily(tenantId, 'net_sales', periods),
    sumDaily(tenantId, 'order_count', periods),
    sumDaily(tenantId, 'ad_spend', periods, 'platform:google_ads'),
    sumDaily(tenantId, 'ad_spend', periods, 'platform:meta'),
  ]);
  const adSpendMinor = googleSpend + metaSpend;
  const mer = adSpendMinor > 0 ? Number((netSalesMinor / adSpendMinor).toFixed(4)) : null;
  const aovMinor = orders > 0 ? Math.round(netSalesMinor / orders) : null;

  // Findings flagged in the window (surfaced, actionable), newest first, deduped
  // by rule+entity so a recurring finding is listed once, and capped for a phone.
  const windowStartMs = new Date(`${windowStart}T00:00:00Z`).getTime();
  const findings = await listFindings(tenantId, { includeSuppressed: false });
  const seen = new Set<string>();
  const flags: string[] = [];
  for (const f of findings
    .filter(
      (f) =>
        (f.status === 'new' || f.status === 'recurring') &&
        f.createdAt instanceof Date &&
        f.createdAt.getTime() >= windowStartMs,
    )
    .sort((a, b) => (b.createdAt as Date).getTime() - (a.createdAt as Date).getTime())) {
    const key = `${f.ruleId} ${f.entityKey}`;
    if (seen.has(key)) continue;
    seen.add(key);
    flags.push(`${RULE_TITLES[f.ruleId] ?? f.ruleId} — ${f.entityLabel}`);
    if (flags.length >= 5) break;
  }

  const input: DigestInput = {
    tenantName: tenant.name,
    currency,
    windowStart,
    windowEnd,
    numbers: { netSalesMinor, adSpendMinor, mer, orders, aovMinor },
    flags,
  };
  return { input, text: buildDigestText(input), hasContent: netSalesMinor > 0 || orders > 0 || flags.length > 0 };
}

/**
 * Send the weekly digest to every active tenant whose digest day is `asOf`
 * (unless `force`). Recipients come from the caller (per tenant); in v1 the
 * analyst passes them. Returns a per-tenant outcome.
 */
export async function sendWeeklyDigests(
  asOf: string,
  opts: { force?: boolean; recipientsFor: (tenantId: string) => string[] },
): Promise<{ tenantId: string; sent: boolean; reason?: string }[]> {
  const settings = await getSettings();
  const config = settings.digest;
  const asOfDate = new Date(`${asOf}T00:00:00Z`);
  const tenants = await listTenants();
  const results: { tenantId: string; sent: boolean; reason?: string }[] = [];
  for (const tenant of tenants) {
    if (tenant.status === 'churned' || tenant.status === 'paused') continue;
    if (!opts.force && !isDigestDay(config, tenant.id, asOfDate)) continue;
    const recipients = opts.recipientsFor(tenant.id);
    if (recipients.length === 0) {
      results.push({ tenantId: tenant.id, sent: false, reason: 'no recipients configured' });
      continue;
    }
    const digest = await buildWeeklyDigest(tenant.id, asOf);
    let result: SendResult;
    try {
      result = await sendEmail({ to: recipients, subject: `${tenant.name} — weekly digest`, text: digest.text });
    } catch (error) {
      result = { sent: false, reason: error instanceof Error ? error.message : 'send failed' };
    }
    results.push({ tenantId: tenant.id, sent: result.sent, reason: result.reason });
  }
  logger.info('weekly digests processed', { asOf, count: results.length, sent: results.filter((r) => r.sent).length });
  return results;
}
