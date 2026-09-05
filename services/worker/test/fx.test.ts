import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterAll, describe, expect, it } from 'vitest';
import { convertMinorUnits } from '@grossline/core';
import { closeDbPools, getFxRate } from '@grossline/db';
import { fetchAndStoreFxRates } from '../src/fx';

const fixturePath = join(
  dirname(fileURLToPath(import.meta.url)),
  'fixtures',
  'fx',
  'synthetic-frankfurter-timeseries.json',
);

const router = (async (input: unknown) => {
  const url = String(input);
  if (!url.includes('frankfurter')) throw new Error(`unrouted url: ${url}`);
  return new Response(readFileSync(fixturePath, 'utf8'), { status: 200 });
}) as typeof fetch;

afterAll(async () => {
  await closeDbPools();
});

describe('fx rates', () => {
  it('stores ECB business-day rates and re-runs idempotently', async () => {
    const first = await fetchAndStoreFxRates({
      start: '2026-08-03',
      end: '2026-08-09',
      symbols: ['USD', 'INR'],
      fetchImpl: router,
    });
    expect(first).toBe(10); // 5 business days × 2 currencies
    // Upsert on (base, quote, rate_date): a second pull cannot duplicate.
    await fetchAndStoreFxRates({
      start: '2026-08-03',
      end: '2026-08-09',
      symbols: ['USD', 'INR'],
      fetchImpl: router,
    });
    const exact = await getFxRate('USD', '2026-08-03');
    expect(exact?.rateDate).toBe('2026-08-03');
    expect(Number(exact?.rate)).toBeCloseTo(1.085, 6);
  });

  it('weekends fall back to the prior business day, and say so', async () => {
    const saturday = await getFxRate('USD', '2026-08-08');
    expect(saturday?.rateDate).toBe('2026-08-07'); // Friday's rate
    expect(Number(saturday?.rate)).toBeCloseTo(1.0912, 6);
  });

  it('a date beyond the lookback window has no rate rather than a stale one', async () => {
    expect(await getFxRate('USD', '2026-08-20')).toBeNull();
  });

  it('a converted amount is traceable to its rate and rate date', async () => {
    const usd = await getFxRate('USD', '2026-08-08');
    const inr = await getFxRate('INR', '2026-08-08');
    const converted = convertMinorUnits({
      amountMinor: 10_000, // $100.00
      from: 'USD',
      to: 'INR',
      eurRates: { USD: usd!.rate, INR: inr!.rate },
      rateDate: usd!.rateDate,
    });
    expect(converted.amountMinor).toBe(857313); // 100 × 93.55/1.0912, in paise
    expect(converted.rateDate).toBe('2026-08-07');
    expect(converted.source).toBe('frankfurter/ecb');
    expect(Number(converted.rate)).toBeCloseTo(93.55 / 1.0912, 9);
  });
});
