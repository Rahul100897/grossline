import { describe, expect, it } from 'vitest';
import { classifyRecommendation } from '../src/index';

describe('recommendation tracking', () => {
  it('is pending until the next period is computed', () => {
    expect(
      classifyRecommendation({ checkMetric: 'blended_cac', baseline: 6473, measured: null, resolvedNextPeriod: false, computedNextPeriod: false }),
    ).toEqual({ status: 'pending', actioned: null, relativeChange: null });
  });

  it('marks resolved when the finding stops firing', () => {
    const j = classifyRecommendation({ checkMetric: 'claim_gap', baseline: 0.63, measured: 0.2, resolvedNextPeriod: true, computedNextPeriod: true });
    expect(j.status).toBe('resolved');
    expect(j.actioned).toBe(true);
  });

  it('marks improving when a lower-is-better metric falls (CAC $64.73 → $54.44)', () => {
    const j = classifyRecommendation({ checkMetric: 'blended_cac', baseline: 6473, measured: 5444, resolvedNextPeriod: false, computedNextPeriod: true });
    expect(j.status).toBe('improving');
    expect(j.actioned).toBe(true);
    expect(j.relativeChange).toBeCloseTo(-0.159, 2);
  });

  it('marks improving when a higher-is-better metric rises (MER 1.8 → 2.2)', () => {
    const j = classifyRecommendation({ checkMetric: 'mer', baseline: 1.8, measured: 2.2, resolvedNextPeriod: false, computedNextPeriod: true });
    expect(j.status).toBe('improving');
  });

  it('marks worsened when a lower-is-better metric climbs', () => {
    const j = classifyRecommendation({ checkMetric: 'discount_share', baseline: 0.05, measured: 0.09, resolvedNextPeriod: false, computedNextPeriod: true });
    expect(j.status).toBe('worsened');
    expect(j.actioned).toBe(false);
  });

  it('marks unchanged within the movement threshold', () => {
    const j = classifyRecommendation({ checkMetric: 'blended_cac', baseline: 6000, measured: 6050, resolvedNextPeriod: false, computedNextPeriod: true });
    expect(j.status).toBe('unchanged');
  });
});
