import { describe, expect, it } from 'vitest';
import { convertMinorUnits, minorUnitExponent } from '../src/money';

// Golden-file style: fixed rates in, exact integer minor units out.
const EUR_RATES = { USD: 1.25, INR: 100, JPY: 150, GBP: 0.8 };

describe('convertMinorUnits', () => {
  it('converts between two-decimal currencies via the EUR cross rate', () => {
    // 123.45 USD → INR at rate 100/1.25 = 80 → 9876.00 INR
    const result = convertMinorUnits({
      amountMinor: 12345,
      from: 'USD',
      to: 'INR',
      eurRates: EUR_RATES,
      rateDate: '2026-08-03',
    });
    expect(result.amountMinor).toBe(987600);
    expect(result.currency).toBe('INR');
    expect(Number(result.rate)).toBeCloseTo(80, 9);
    expect(result.rateDate).toBe('2026-08-03');
  });

  it('is exponent-aware for zero-decimal currencies', () => {
    // ¥1000 → USD at rate 1.25/150 → $8.3333… → 833 cents
    const result = convertMinorUnits({
      amountMinor: 1000,
      from: 'JPY',
      to: 'USD',
      eurRates: EUR_RATES,
      rateDate: '2026-08-03',
    });
    expect(result.amountMinor).toBe(833);
  });

  it('converts to and from EUR itself', () => {
    const toEur = convertMinorUnits({
      amountMinor: 12500,
      from: 'USD',
      to: 'EUR',
      eurRates: EUR_RATES,
      rateDate: '2026-08-03',
    });
    expect(toEur.amountMinor).toBe(10000);
  });

  it('same-currency conversion is the identity with rate 1', () => {
    const result = convertMinorUnits({
      amountMinor: 999,
      from: 'USD',
      to: 'USD',
      eurRates: {},
      rateDate: '2026-08-03',
    });
    expect(result).toMatchObject({ amountMinor: 999, rate: '1' });
  });

  it('refuses floats and missing rates loudly', () => {
    expect(() =>
      convertMinorUnits({
        amountMinor: 12.5,
        from: 'USD',
        to: 'EUR',
        eurRates: EUR_RATES,
        rateDate: '2026-08-03',
      }),
    ).toThrow(/integer/);
    expect(() =>
      convertMinorUnits({
        amountMinor: 100,
        from: 'USD',
        to: 'XYZ',
        eurRates: EUR_RATES,
        rateDate: '2026-08-03',
      }),
    ).toThrow(/no usable EUR rate for XYZ/);
  });

  it('knows minor unit exponents', () => {
    expect(minorUnitExponent('USD')).toBe(2);
    expect(minorUnitExponent('JPY')).toBe(0);
    expect(minorUnitExponent('KWD')).toBe(3);
  });
});
