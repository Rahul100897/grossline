import { describe, expect, it } from 'vitest';
import { valueIsExclusive } from '../src/index';

// task 5.A1 — a finding carries a money_impact (waste/measurement) OR an
// opportunity_value (growth), never both. The database enforces the same rule
// with a check constraint (see the DB-level test in services/worker); this is
// the pure guard the rules and callers use.
describe('valueIsExclusive — money_impact XOR opportunity_value', () => {
  it('allows a waste finding: money impact, no opportunity', () => {
    expect(valueIsExclusive({ moneyImpactMinor: 120_000, opportunityValueMinor: null })).toBe(true);
  });

  it('allows a measurement finding: zero money impact, no opportunity', () => {
    expect(valueIsExclusive({ moneyImpactMinor: 0, opportunityValueMinor: null })).toBe(true);
  });

  it('allows a growth finding: zero money impact, an opportunity value', () => {
    expect(valueIsExclusive({ moneyImpactMinor: 0, opportunityValueMinor: 250_000 })).toBe(true);
  });

  it('rejects a finding carrying both a money impact and an opportunity value', () => {
    expect(valueIsExclusive({ moneyImpactMinor: 120_000, opportunityValueMinor: 250_000 })).toBe(
      false,
    );
  });
});
