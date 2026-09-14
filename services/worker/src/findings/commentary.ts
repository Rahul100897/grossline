// Commentary tier 2 (docs/phase-4.md task 4.6): a model-drafted narrative over
// the deterministic template. The model receives the finding's computed numbers
// and nothing else — no raw tables, no ability to calculate — and its output is
// run through the figure guard (foreignFigures) so it can polish prose but can
// never introduce a number that is not already in the finding record. Any
// failure (no API key, API error, a foreign figure) falls back to the
// deterministic template, which is always safe. No SDK dependency — plain fetch.
import {
  foreignFigures,
  renderTemplate,
  logger,
  FINDING_PART_KEYS,
  type CommentaryFinding,
  type FindingParts,
  type FourPart,
} from '@grossline/core';
import { getTenant, listFindings, saveFindingDraftParts, type Finding } from '@grossline/db';

const ANTHROPIC_ENDPOINT = 'https://api.anthropic.com/v1/messages';

export function toCommentary(f: Finding): CommentaryFinding {
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

export type DraftResult = { parts: FindingParts; source: 'model' | 'template'; note?: string };

/** Strip a ```json … ``` fence the model may wrap the object in. */
function stripFence(text: string): string {
  const m = text.match(/```(?:json)?\s*([\s\S]*?)```/i);
  return (m?.[1] ?? text).trim();
}

/** Ask the model to rewrite the four parts. Returns the parts it produced (each
 *  still unguarded), or null on any failure. */
async function callModel(
  commentary: CommentaryFinding,
  template: FourPart,
): Promise<FindingParts | null> {
  const key = process.env.ANTHROPIC_API_KEY;
  if (!key) return null;
  const model = process.env.ANTHROPIC_MODEL ?? 'claude-sonnet-5';
  const system =
    'You are an analyst writing one finding for a monthly ecommerce report. Rewrite the draft into a natural, client-ready note in four short parts. Return ONLY a JSON object with string keys "whatHappened" (what happened, with the numbers), "atStake" (what is at stake, a figure), "whatToDo" (what to do, specific), and "whatWeCheck" (what we check next month, name the metric). CRITICAL: use ONLY numbers that appear in the provided record or draft. Never invent, estimate, or compute any figure. Keep each part to a sentence or two.';
  const user = JSON.stringify({ record: commentary, draft: template });
  try {
    const response = await fetch(ANTHROPIC_ENDPOINT, {
      method: 'POST',
      headers: {
        'x-api-key': key,
        'anthropic-version': '2023-06-01',
        'content-type': 'application/json',
      },
      body: JSON.stringify({
        model,
        max_tokens: 600,
        system,
        messages: [{ role: 'user', content: user }],
      }),
    });
    if (!response.ok) {
      logger.warn('commentary model call failed', { status: response.status });
      return null;
    }
    const data = (await response.json()) as { content?: { type: string; text?: string }[] };
    const text = data.content?.find((b) => b.type === 'text')?.text?.trim();
    if (!text) return null;
    const parsed = JSON.parse(stripFence(text)) as Record<string, unknown>;
    const parts: FindingParts = {};
    for (const k of FINDING_PART_KEYS) {
      if (typeof parsed[k] === 'string' && (parsed[k] as string).trim() !== '') {
        parts[k] = (parsed[k] as string).trim();
      }
    }
    return parts;
  } catch (error) {
    logger.warn('commentary model call errored', {
      error: error instanceof Error ? error.message : 'unknown',
    });
    return null;
  }
}

/**
 * Draft one finding as four parts. Each model part must pass the figure guard on
 * its own; a part that fails (or that the model didn't return) is left out, so
 * the review editor prefills the template part for it. Returns only the parts the
 * model produced that cleared the guard.
 */
export async function draftFor(finding: Finding): Promise<DraftResult> {
  const commentary = toCommentary(finding);
  const template = renderTemplate(commentary);
  const modelParts = await callModel(commentary, template);
  if (modelParts === null) return { parts: {}, source: 'template' };

  const kept: FindingParts = {};
  const rejected: string[] = [];
  for (const k of FINDING_PART_KEYS) {
    const value = modelParts[k];
    if (!value) continue;
    const foreign = foreignFigures(value, commentary);
    if (foreign.length === 0) kept[k] = value;
    else rejected.push(`${k}: ${foreign.join(', ')}`);
  }
  if (rejected.length > 0) {
    logger.warn('model draft parts rejected — foreign figures', {
      findingId: finding.id,
      rejected,
    });
  }
  return {
    parts: kept,
    source: Object.keys(kept).length > 0 ? 'model' : 'template',
    note: rejected.length > 0 ? `rejected: ${rejected.join('; ')}` : undefined,
  };
}

/**
 * Generate and store draft parts for a period's findings. Skips dismissed
 * findings and never overwrites an analyst's final parts (saveFindingDraftParts
 * only touches draft_parts). Returns a per-finding summary.
 */
export async function generateDraftsForPeriod(
  tenantId: string,
  period: string,
): Promise<{ id: string; ruleId: string; source: DraftResult['source'] }[]> {
  const tenant = await getTenant(tenantId);
  if (!tenant) throw new Error(`tenant not found: ${tenantId}`);
  const findings = await listFindings(tenantId, { period, includeSuppressed: true });
  const results: { id: string; ruleId: string; source: DraftResult['source'] }[] = [];
  for (const finding of findings) {
    if (finding.status === 'dismissed') continue;
    const draft = await draftFor(finding);
    await saveFindingDraftParts(tenantId, finding.id, draft.parts);
    results.push({ id: finding.id, ruleId: finding.ruleId, source: draft.source });
  }
  logger.info('drafts generated', {
    tenantId,
    period,
    count: results.length,
    fromModel: results.filter((r) => r.source === 'model').length,
  });
  return results;
}
