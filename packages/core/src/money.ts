// Currency conversion over integer minor units. Every converted amount
// carries the rate used and the rate's date so the figure is reproducible
// (CLAUDE.md non-negotiable #4).

/** Currencies whose minor unit is not 1/100. Everything else defaults to 2. */
const MINOR_UNIT_EXPONENTS: Record<string, number> = {
  BIF: 0, CLP: 0, DJF: 0, GNF: 0, ISK: 0, JPY: 0, KMF: 0, KRW: 0, PYG: 0,
  RWF: 0, UGX: 0, VND: 0, VUV: 0, XAF: 0, XOF: 0, XPF: 0,
  BHD: 3, IQD: 3, JOD: 3, KWD: 3, LYD: 3, OMR: 3, TND: 3,
};

export function minorUnitExponent(currency: string): number {
  return MINOR_UNIT_EXPONENTS[currency.toUpperCase()] ?? 2;
}

export type ConvertedAmount = {
  amountMinor: number;
  currency: string;
  /** The cross rate applied (1 unit of `from` in `to`), as recorded. */
  rate: string;
  /** The date of the FX rate actually used — may precede the requested date. */
  rateDate: string;
  source: string;
};

/**
 * Convert integer minor units between currencies using base-EUR rates
 * (ECB style): rate(from→to) = eur→to / eur→from. Exponent-aware, so
 * zero-decimal currencies (JPY, KRW, …) convert correctly.
 */
export function convertMinorUnits(input: {
  amountMinor: number;
  from: string;
  to: string;
  /** 1 EUR in each currency, keyed by currency code. EUR itself is implicit. */
  eurRates: Record<string, number | string>;
  rateDate: string;
  source?: string;
}): ConvertedAmount {
  const from = input.from.toUpperCase();
  const to = input.to.toUpperCase();
  const source = input.source ?? 'frankfurter/ecb';
  if (!Number.isInteger(input.amountMinor)) {
    throw new Error('amountMinor must be an integer — money never travels as floats');
  }
  if (from === to) {
    return { amountMinor: input.amountMinor, currency: to, rate: '1', rateDate: input.rateDate, source };
  }
  const eurTo = (code: string): number => {
    if (code === 'EUR') return 1;
    const raw = input.eurRates[code];
    const value = typeof raw === 'string' ? Number(raw) : raw;
    if (value === undefined || !Number.isFinite(value) || value <= 0) {
      throw new Error(`no usable EUR rate for ${code} on ${input.rateDate}`);
    }
    return value;
  };
  const rate = eurTo(to) / eurTo(from);
  const scaled =
    (input.amountMinor / 10 ** minorUnitExponent(from)) * rate * 10 ** minorUnitExponent(to);
  return {
    amountMinor: Math.round(scaled),
    currency: to,
    rate: rate.toPrecision(12),
    rateDate: input.rateDate,
    source,
  };
}
