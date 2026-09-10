// Presentation helpers for findings in the console (docs/phase-4.md tasks
// 4.5–4.8). These format the numbers already in the finding record — they never
// compute a new figure. Prose lives in draft_text/final_text.
import { renderTemplate, type CommentaryFinding } from '@grossline/core';
import type { Finding } from '@grossline/db';
import { formatMinor } from './format';

/** The deterministic four-part template for a finding, rendered from the record. */
export function templateText(f: Finding): string {
  const commentary: CommentaryFinding = {
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
  return renderTemplate(commentary).text;
}

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
  spend_headroom: 'Spend headroom',
  scale_signal: 'Scale signal',
};

export function ruleTitle(ruleId: string): string {
  return RULE_TITLES[ruleId] ?? ruleId;
}

/** Family badge label + tone for the review card (task 5.A5). A growth finding
 * must never read like a waste finding at a glance. */
export function familyBadge(f: Finding): {
  label: string;
  tone: 'waste' | 'growth' | 'measurement';
} {
  switch (f.family) {
    case 'growth':
      return { label: 'Growth opportunity', tone: 'growth' };
    case 'measurement':
      return { label: 'Measurement risk', tone: 'measurement' };
    default:
      return { label: 'Waste', tone: 'waste' };
  }
}

/** The finding's headline value — a saving to recover, or a gain to pursue. */
export function findingValueLabel(f: Finding): string {
  if (f.family === 'growth') {
    return f.opportunityValueMinor === null
      ? 'opportunity'
      : `${formatMinor(f.opportunityValueMinor, f.currency ?? 'USD')} opportunity`;
  }
  if (f.family === 'measurement') return 'no money at stake';
  return `${formatMinor(f.moneyImpactMinor, f.currency ?? 'USD')} at stake`;
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
  return (
    !f.suppressed && f.status !== 'dismissed' && f.status !== 'resolved' && f.approvedAt === null
  );
}

export type FindingGroups = {
  needsReview: Finding[];
  approved: Finding[];
  resolved: Finding[];
  suppressed: Finding[];
  dismissed: Finding[];
};

export function groupFindings(findings: Finding[]): FindingGroups {
  const groups: FindingGroups = {
    needsReview: [],
    approved: [],
    resolved: [],
    suppressed: [],
    dismissed: [],
  };
  for (const f of findings) {
    if (f.status === 'dismissed') groups.dismissed.push(f);
    else if (f.suppressed) groups.suppressed.push(f);
    else if (f.status === 'resolved') groups.resolved.push(f);
    else if (f.approvedAt !== null) groups.approved.push(f);
    else groups.needsReview.push(f);
  }
  return groups;
}
