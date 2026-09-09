// Presentation helpers for findings in the console (docs/phase-4.md tasks
// 4.5–4.8). These format the numbers already in the finding record — they never
// compute a new figure. Prose lives in draft_text/final_text.
import type { Finding } from '@grossline/db';
import { formatMinor } from './format';

export const RULE_TITLES: Record<string, string> = {
  below_break_even_mer: 'Below break-even MER',
  dead_campaign: 'Dead campaign',
  branded_search_share: 'Branded search share',
  search_term_waste: 'Search term waste',
  discount_leakage: 'Discount leakage',
  refund_outlier: 'Refund outlier',
  payback_broken: 'Payback broken',
  claim_gap: 'Claim gap',
  spend_pacing: 'Spend pacing',
};

export function ruleTitle(ruleId: string): string {
  return RULE_TITLES[ruleId] ?? ruleId;
}

export function statusLabel(f: Finding): string {
  switch (f.status) {
    case 'new':
      return 'new';
    case 'recurring':
      return `recurring · month ${f.occurrenceCount}`;
    case 'resolved':
      return 'resolved';
    case 'dismissed':
      return 'dismissed';
  }
}

export function statusTone(f: Finding): 'attn' | 'good' | 'neutral' {
  if (f.status === 'resolved') return 'good';
  if (f.status === 'dismissed') return 'neutral';
  if (f.status === 'recurring') return 'attn';
  return 'attn';
}

/** The money-at-stake, formatted; measurement-risk findings show no figure. */
export function impactText(f: Finding): string | null {
  if (f.moneyImpactMinor === 0) return null;
  return formatMinor(f.moneyImpactMinor, f.currency ?? 'USD');
}

export function isReviewed(f: Finding): boolean {
  return f.approvedAt !== null || f.status === 'dismissed';
}

/** True for a finding that awaits the analyst — surfaced, not yet acted on. */
export function needsReview(f: Finding): boolean {
  return !f.suppressed && f.status !== 'dismissed' && f.status !== 'resolved' && f.approvedAt === null;
}

export type FindingGroups = {
  needsReview: Finding[];
  approved: Finding[];
  resolved: Finding[];
  suppressed: Finding[];
  dismissed: Finding[];
};

export function groupFindings(findings: Finding[]): FindingGroups {
  const groups: FindingGroups = { needsReview: [], approved: [], resolved: [], suppressed: [], dismissed: [] };
  for (const f of findings) {
    if (f.status === 'dismissed') groups.dismissed.push(f);
    else if (f.suppressed) groups.suppressed.push(f);
    else if (f.status === 'resolved') groups.resolved.push(f);
    else if (f.approvedAt !== null) groups.approved.push(f);
    else groups.needsReview.push(f);
  }
  return groups;
}
