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
  type CommentaryFinding,
} from '@grossline/core';
import { getTenant, listFindings, saveFindingDraft, type Finding } from '@grossline/db';

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
  };
}

export type DraftResult = { text: string; source: 'model' | 'template'; note?: string };

async function callModel(commentary: CommentaryFinding, template: string): Promise<string | null> {
  const key = process.env.ANTHROPIC_API_KEY;
  if (!key) return null;
  const model = process.env.ANTHROPIC_MODEL ?? 'claude-sonnet-5';
  const system =
    'You are an analyst writing one finding for a monthly ecommerce report. Rewrite the draft into a natural, client-ready note in four short parts: what happened (with the numbers), what is at stake (a figure), what to do (specific), and what we check next month (name the metric). CRITICAL: use ONLY numbers that appear in the provided record or draft. Never invent, estimate, or compute any figure. Keep it to a few sentences. Return only the note.';
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
        max_tokens: 400,
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
    return text && text.length > 0 ? text : null;
  } catch (error) {
    logger.warn('commentary model call errored', { error: error instanceof Error ? error.message : 'unknown' });
    return null;
  }
}

/** Draft one finding: model narrative if it passes the figure guard, else template. */
export async function draftFor(finding: Finding): Promise<DraftResult> {
  const commentary = toCommentary(finding);
  const template = renderTemplate(commentary).text;
  const modelText = await callModel(commentary, template);
  if (modelText === null) return { text: template, source: 'template' };
  const foreign = foreignFigures(modelText, commentary);
  if (foreign.length > 0) {
    logger.warn('model draft rejected — foreign figures', { findingId: finding.id, foreign });
    return { text: template, source: 'template', note: `model draft rejected: ${foreign.join(', ')}` };
  }
  return { text: modelText, source: 'model' };
}

/**
 * Generate and store drafts for a period's findings. Skips dismissed findings
 * and never overwrites an analyst's final edit (saveFindingDraft only touches
 * draft_text). Returns a per-finding summary.
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
    await saveFindingDraft(tenantId, finding.id, draft.text);
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
