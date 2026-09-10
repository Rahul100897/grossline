// Commentary (docs/phase-4.md task 4.6). Two tiers, both here as pure functions:
//   1. renderTemplate — a deterministic four-part note filled from the finding
//      record. No model, always correct.
//   2. the figure guard — foreignFigures / hasNoForeignFigures — which the
//      worker runs over the model's draft so the model can polish prose but can
//      never introduce a number that is not already in the finding record.
// The four parts are always: what happened (with the numbers), what is at stake
// (a figure), what to do (specifically), what we check next month (a metric).
import { minorUnitExponent } from '../money';
import type { Evidence, FindingFamily } from './types';

export type CommentaryFinding = {
  ruleId: string;
  entityLabel: string;
  currency: string;
  status: 'new' | 'recurring' | 'resolved' | 'dismissed';
  occurrenceCount: number;
  moneyImpactMinor: number;
  currentValue: number | null;
  comparisonValue: number | null;
  delta: number | null;
  evidence: Evidence;
  checkMetric: string | null;
  /** Growth findings (task 5.A5): the family and the hypothetical gain. */
  family?: FindingFamily;
  opportunityValueMinor?: number | null;
};

export type FourPart = {
  whatHappened: string;
  atStake: string;
  whatToDo: string;
  whatWeCheck: string;
  text: string;
};

const num = (e: Evidence, k: string): number | null =>
  typeof e[k] === 'number' ? (e[k] as number) : null;

function money(minor: number | null, currency: string): string {
  if (minor === null) return '—';
  const exp = minorUnitExponent(currency);
  return `${currency} ${(minor / 10 ** exp).toLocaleString('en-US', { minimumFractionDigits: exp, maximumFractionDigits: exp })}`;
}

function pct(rate: number | null): string {
  if (rate === null) return '—';
  return `${(rate * 100).toFixed(1)}%`;
}

const CHECK_LABEL: Record<string, string> = {
  mer: 'MER against break-even',
  blended_cac: 'blended CAC against first-order contribution',
  discount_share: 'discount share against gross sales',
  spend_projected_month_end: 'projected month-end spend against target',
  ad_spend: 'spend on this campaign',
  branded_search_share: 'branded share of Google spend',
  search_term_cost: 'wasted search-term cost',
  refund_rate: 'this product’s refund rate',
  claim_gap: 'the platform-to-store claim gap',
  platform_roas: 'the campaign’s platform-reported ROAS',
};

function combine(parts: Omit<FourPart, 'text'>): FourPart {
  return {
    ...parts,
    text: `${parts.whatHappened} ${parts.atStake} ${parts.whatToDo} ${parts.whatWeCheck}`,
  };
}

export function renderTemplate(f: CommentaryFinding): FourPart {
  const c = f.currency;
  const check = f.checkMetric ? (CHECK_LABEL[f.checkMetric] ?? f.checkMetric) : 'the same metric';
  const e = f.evidence;
  const stake = money(f.moneyImpactMinor, c);
  // Growth findings speak of an opportunity, not a loss.
  const opportunity = money(f.opportunityValueMinor ?? null, c);
  const recurring = f.status === 'recurring' ? ` This is month ${f.occurrenceCount}.` : '';

  switch (f.ruleId) {
    // ---- growth variants (task 5.A5): a bounded test, never an instruction ----
    case 'spend_headroom':
      return combine({
        whatHappened: `Blended MER is running at ${(f.currentValue ?? 0).toFixed(2)} against a break-even of ${(f.comparisonValue ?? 0).toFixed(2)} on ${money(num(e, 'totalAdSpendMinor'), c)} of ad spend — comfortably profitable.${recurring}`,
        atStake: `At today's efficiency there is roughly ${opportunity} of additional monthly spend that would still clear break-even. Efficiency falls as spend rises, so treat this as a ceiling, not a target.`,
        whatToDo: `Test a bounded increase — not the full figure — on the strongest campaigns for a defined period, and hold if efficiency slips.`,
        whatWeCheck: `Next month we check ${check} and total orders to see whether the added spend paid.`,
      });
    case 'scale_signal':
      return combine({
        whatHappened: `${f.entityLabel} is running a platform-reported ROAS of ${(f.currentValue ?? 0).toFixed(2)} against an account average of ${(f.comparisonValue ?? 0).toFixed(2)}, on a small share of spend.${recurring}`,
        atStake: `Shifting a bounded slice of budget toward it could be worth about ${opportunity} — an estimate that holds only if efficiency holds as it scales. This is a platform-reported figure, not blended.`,
        whatToDo: `Move a small, capped share of budget into it and watch whether the platform-reported ROAS holds before adding more.`,
        whatWeCheck: `Next month we check ${check}.`,
      });
    case 'below_break_even_mer':
      return combine({
        whatHappened: `MER came in at ${(f.currentValue ?? 0).toFixed(2)} against a break-even of ${(f.comparisonValue ?? 0).toFixed(2)} on ${money(num(e, 'totalAdSpendMinor'), c)} of ad spend.${recurring}`,
        atStake: `At this efficiency, roughly ${stake} of contribution is being lost to spend that does not pay for itself.`,
        whatToDo: `Cut or reallocate the least efficient spend until blended MER clears break-even, or lift margin so break-even falls.`,
        whatWeCheck: `Next month we check ${check}.`,
      });
    case 'payback_broken':
      return combine({
        whatHappened: `Blended CAC is ${money(num(e, 'blendedCacMinor'), c)} while first-order contribution is only ${money(num(e, 'firstOrderContributionMinor'), c)} — acquisition does not pay back on the first order.${recurring}`,
        atStake: `Across ${num(e, 'newCustomerCount') ?? 0} new customers that is a ${stake} first-order gap, carried until the second purchase.`,
        whatToDo: `Lift first-order AOV (bundle or a free-shipping threshold) or trim the weakest prospecting spend so CAC falls below first-order contribution.`,
        whatWeCheck: `Next month we check ${check}.`,
      });
    case 'discount_leakage':
      return combine({
        whatHappened: `Discounts rose to ${pct(f.currentValue)} of gross sales from ${pct(f.comparisonValue)} the prior period.${recurring}`,
        atStake: `That rise is about ${stake} of additional discount at current gross sales.`,
        whatToDo: `Review which codes drove the increase and whether they are funding sales that would have happened anyway.`,
        whatWeCheck: `Next month we check ${check}.`,
      });
    case 'spend_pacing':
      return combine({
        whatHappened: `Projected month-end spend is ${money(num(e, 'projectedMinor'), c)} against a ${money(num(e, 'targetMinor'), c)} target.${recurring}`,
        atStake: `At the current run rate that is ${stake} over budget.`,
        whatToDo: `Ease daily budgets on the least efficient campaigns to bring the projection back to target.`,
        whatWeCheck: `Next month we check ${check}.`,
      });
    case 'dead_campaign':
      return combine({
        whatHappened: `${f.entityLabel} spent ${money(num(e, 'spendMinor'), c)} with zero attributed orders in the last 30 days.${recurring}`,
        atStake: `The full ${stake} produced no attributable revenue.`,
        whatToDo: `Pause the campaign or restructure it; if it is a brand-defence play, mark it deliberate.`,
        whatWeCheck: `Next month we check ${check}.`,
      });
    case 'branded_search_share':
      return combine({
        whatHappened: `Branded terms are ${pct(f.currentValue)} of Google spend, above the ${pct(f.comparisonValue)} ceiling.${recurring}`,
        atStake: `About ${stake} is going to clicks you likely win organically.`,
        whatToDo: `Test lowering branded bids and watch whether total branded conversions hold.`,
        whatWeCheck: `Next month we check ${check}.`,
      });
    case 'search_term_waste':
      return combine({
        whatHappened: `${num(e, 'termCount') ?? 0} search terms took spend with no conversions.${recurring}`,
        atStake: `That is ${stake} of wasted click cost.`,
        whatToDo: `Add the worst offenders as negative keywords.`,
        whatWeCheck: `Next month we check ${check}.`,
      });
    case 'refund_outlier':
      return combine({
        whatHappened: `${f.entityLabel} refunds at ${pct(f.currentValue)}, above ${pct(f.comparisonValue)} (the store multiple), while receiving ad spend.${recurring}`,
        atStake: `Refunded value plus spend on it is about ${stake}.`,
        whatToDo: `Check the listing and fulfilment for this product before spending more behind it.`,
        whatWeCheck: `Next month we check ${check}.`,
      });
    case 'claim_gap':
      return combine({
        whatHappened: `${f.entityLabel} claims ${num(e, 'platformConversions') ?? 0} conversions against ${num(e, 'storeOrders') ?? 0} store-recorded orders — a ${pct(f.currentValue)} gap, beyond the ${pct(f.comparisonValue)} tolerance.${recurring}`,
        atStake: `This is a measurement risk, not a spend loss: treat the platform's own conversion count with caution.`,
        whatToDo: `No spend action. Rely on store-recorded orders for decisions and note the divergence in the report.`,
        whatWeCheck: `Next month we check ${check}.`,
      });
    default:
      return combine({
        whatHappened: `${f.entityLabel}: ${f.ruleId} triggered.${recurring}`,
        atStake: `Estimated impact ${stake}.`,
        whatToDo: `Review the evidence and decide on an action.`,
        whatWeCheck: `Next month we check ${check}.`,
      });
  }
}

// ---- the figure guard ------------------------------------------------------

/** Numbers that may legitimately appear in prose about this finding. */
export function allowedFigures(f: CommentaryFinding): number[] {
  const exp = minorUnitExponent(f.currency);
  const out = new Set<number>();
  const add = (v: number | null | undefined): void => {
    if (v === null || v === undefined || !Number.isFinite(v)) return;
    out.add(round4(v)); // raw
    out.add(round4(v / 10 ** exp)); // money major, if v is minor
    out.add(round4(v * 100)); // percent, if v is a rate
    out.add(Math.round(v)); // integer form
    out.add(round2(v / 10 ** exp));
    out.add(round1(v * 100));
  };
  add(f.moneyImpactMinor);
  add(f.opportunityValueMinor ?? null); // the growth finding's hypothetical gain
  add(f.currentValue);
  add(f.comparisonValue);
  add(f.delta);
  add(f.occurrenceCount);
  for (const v of Object.values(f.evidence)) if (typeof v === 'number') add(v);
  return [...out];
}

/** Numeric tokens in a text, each with its plain and percent interpretations. */
function extractFigures(text: string): { raw: string; interpretations: number[] }[] {
  const tokens = text.match(/-?\$?\d[\d,]*(?:\.\d+)?%?/g) ?? [];
  return tokens.map((raw) => {
    const isPct = raw.includes('%');
    const n = Number(raw.replace(/[$,%]/g, ''));
    const interpretations = [round4(n), Math.round(n), round2(n), round1(n)];
    if (isPct) interpretations.push(round4(n / 100));
    return { raw, interpretations };
  });
}

const TOLERANCE = 0.02;

function matches(value: number, allowed: number[]): boolean {
  return allowed.some(
    (a) => Math.abs(a - value) <= TOLERANCE || (a !== 0 && Math.abs((a - value) / a) <= 0.005),
  );
}

/**
 * Figures that appear in `text` but cannot be derived from the finding record.
 * The model's draft is rejected (and the deterministic template used instead)
 * when this is non-empty.
 */
export function foreignFigures(text: string, f: CommentaryFinding): string[] {
  const allowed = allowedFigures(f);
  const foreign: string[] = [];
  for (const fig of extractFigures(text)) {
    if (!fig.interpretations.some((v) => matches(v, allowed))) foreign.push(fig.raw);
  }
  return foreign;
}

export function hasNoForeignFigures(text: string, f: CommentaryFinding): boolean {
  return foreignFigures(text, f).length === 0;
}

const round4 = (v: number): number => Math.round(v * 10_000) / 10_000;
const round2 = (v: number): number => Math.round(v * 100) / 100;
const round1 = (v: number): number => Math.round(v * 10) / 10;
