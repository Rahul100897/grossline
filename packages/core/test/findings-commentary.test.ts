import { describe, expect, it } from 'vitest';
import {
  renderTemplate,
  foreignFigures,
  hasNoForeignFigures,
  type CommentaryFinding,
} from '../src/index';

// Demo-shaped payback finding (August): CAC $58.42, first-order contribution
// $54.31, gap $5.58 × 103 = ~$558.96, blended MER healthy.
const payback: CommentaryFinding = {
  ruleId: 'payback_broken',
  entityLabel: 'Whole account',
  currency: 'USD',
  status: 'recurring',
  occurrenceCount: 4,
  moneyImpactMinor: 55_896,
  currentValue: 5842,
  comparisonValue: 5431,
  delta: 411,
  evidence: {
    blendedCacMinor: 5842,
    firstOrderContributionMinor: 5431,
    gapMinor: 411,
    newCustomerCount: 103,
  },
  checkMetric: 'blended_cac',
};

describe('deterministic templates (tier 1)', () => {
  it('renders the four-part note from the record', () => {
    const t = renderTemplate(payback);
    expect(t.whatHappened).toContain('USD 58.42');
    expect(t.whatHappened).toContain('USD 54.31');
    expect(t.whatHappened).toContain('month 4');
    expect(t.atStake).toContain('103 new customers');
    expect(t.atStake).toContain('USD 558.96');
    expect(t.whatWeCheck).toContain('blended CAC against first-order contribution');
    // Four parts joined.
    expect(t.text).toBe(`${t.whatHappened} ${t.atStake} ${t.whatToDo} ${t.whatWeCheck}`);
  });

  it('every template passes its own figure guard (uses only record figures)', () => {
    const claim: CommentaryFinding = {
      ruleId: 'claim_gap',
      entityLabel: 'Google Ads',
      currency: 'USD',
      status: 'new',
      occurrenceCount: 1,
      moneyImpactMinor: 0,
      currentValue: 0.63,
      comparisonValue: 0.6166,
      delta: 0.0134,
      evidence: { claimGap: 0.63, tolerance: 0.6166, platformConversions: 120, storeOrders: 44, spendMinor: 365_000, measurementRisk: true },
      checkMetric: 'claim_gap',
    };
    for (const f of [payback, claim]) {
      const t = renderTemplate(f);
      expect(foreignFigures(t.text, f), `${f.ruleId} template must contain no foreign figures`).toEqual([]);
    }
  });
});

describe('figure guard (the model never introduces a number)', () => {
  it('accepts prose that uses only figures from the record', () => {
    const clean =
      'Blended CAC of USD 58.42 outruns first-order contribution of USD 54.31; across 103 new customers that is a USD 558.96 gap. Lift AOV or trim prospecting spend.';
    expect(hasNoForeignFigures(clean, payback)).toBe(true);
  });

  it('flags a figure that is not in the record', () => {
    // "47 campaigns" and "12%" are nowhere in the payback record.
    const hallucinated =
      'Blended CAC USD 58.42 exceeds contribution; we found 47 wasteful campaigns burning 12% of budget.';
    const foreign = foreignFigures(hallucinated, payback);
    expect(foreign).toContain('47');
    expect(foreign).toContain('12%');
    expect(hasNoForeignFigures(hallucinated, payback)).toBe(false);
  });

  it('does not flag figures that restate record numbers in another form', () => {
    // 55896 (minor), 558.96 (major) and rounded 559 are all derivable.
    const restated = 'The gap is USD 558.96 (5,589,600 cents notwithstanding), about 559 dollars.';
    // 5,589,600 is 55,896 × 100 — a further money scaling; allow the major/round forms.
    const foreign = foreignFigures('The gap is USD 558.96, about 559 dollars.', payback);
    expect(foreign).toEqual([]);
    void restated;
  });
});
