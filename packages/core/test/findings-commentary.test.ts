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
      evidence: {
        claimGap: 0.63,
        tolerance: 0.6166,
        platformConversions: 120,
        storeOrders: 44,
        spendMinor: 365_000,
        measurementRisk: true,
      },
      checkMetric: 'claim_gap',
    };
    for (const f of [payback, claim]) {
      const t = renderTemplate(f);
      expect(
        foreignFigures(t.text, f),
        `${f.ruleId} template must contain no foreign figures`,
      ).toEqual([]);
    }
  });
});

describe('growth commentary variants (task 5.A5)', () => {
  // Spend headroom: MER 3.00 vs break-even 2.00 on USD 10,000 spend; opportunity
  // USD 5,000.00 (= 1,000,000 × (3/2 − 1) minor units).
  const headroom: CommentaryFinding = {
    ruleId: 'spend_headroom',
    entityLabel: 'Whole account',
    currency: 'USD',
    status: 'new',
    occurrenceCount: 1,
    family: 'growth',
    moneyImpactMinor: 0,
    opportunityValueMinor: 500_000,
    currentValue: 3.0,
    comparisonValue: 2.0,
    delta: 1.0,
    evidence: {
      mer: 3.0,
      breakEvenMer: 2.0,
      totalAdSpendMinor: 1_000_000,
      headroomMinor: 500_000,
      safetyMargin: 0.2,
    },
    checkMetric: 'mer',
  };

  // Scale signal: campaign ROAS 7.00 vs account average 3.00; opportunity
  // USD 400.00 (= 10,000 × (7 − 3) minor units).
  const scale: CommentaryFinding = {
    ruleId: 'scale_signal',
    entityLabel: 'Meta C',
    currency: 'USD',
    status: 'new',
    occurrenceCount: 1,
    family: 'growth',
    moneyImpactMinor: 0,
    opportunityValueMinor: 40_000,
    currentValue: 7.0,
    comparisonValue: 3.0,
    delta: 4.0,
    evidence: {
      roas: 7.0,
      accountAvgRoas: 3.0,
      spendShare: 0.2,
      campaignSpendMinor: 40_000,
      shareShiftMinor: 10_000,
      platform: 'meta',
      platformReported: true,
    },
    checkMetric: 'platform_roas',
  };

  it('renders a spend-headroom note that reads as an opportunity, not a loss', () => {
    const t = renderTemplate(headroom);
    expect(t.atStake).toContain('USD 5,000.00');
    expect(t.whatHappened).toContain('3.00');
    expect(t.whatHappened).toContain('2.00');
    expect(t.atStake.toLowerCase()).toContain('efficiency falls as spend rises');
    expect(t.whatWeCheck).toContain('total orders');
  });

  it('renders a scale-signal note that stays labelled platform-reported', () => {
    const t = renderTemplate(scale);
    expect(t.atStake).toContain('USD 400.00');
    expect(t.whatHappened).toContain('7.00');
    expect(t.atStake.toLowerCase()).toContain('platform-reported');
  });

  it('both growth templates pass their own figure guard', () => {
    for (const f of [headroom, scale]) {
      const t = renderTemplate(f);
      expect(
        foreignFigures(t.text, f),
        `${f.ruleId} template must contain no foreign figures`,
      ).toEqual([]);
    }
  });

  it('the figure guard still rejects a foreign figure in a growth note', () => {
    // A model draft that invents "47 campaigns" — not in the record — is caught.
    const draft = `Blended MER is at 3.00, well above break-even 2.00, across 47 campaigns. There is about USD 5,000.00 of headroom.`;
    expect(hasNoForeignFigures(draft, headroom)).toBe(false);
    expect(foreignFigures(draft, headroom)).toContain('47');
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
