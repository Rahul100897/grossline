// FX rate storage and lookup. fx_rates is global reference data — the one
// deliberate exception (alongside admin_users) to tenant scoping, recorded in
// docs/decisions.md. Reads/writes go through the admin connection here.
import { and, desc, eq, gte, lte, sql } from 'drizzle-orm';
import { z } from 'zod';
import { adminDb } from './client';
import { fxRates } from './schema';

const dateString = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);

export type FxRateInput = {
  quote: string;
  rate: string; // decimal string, never a float in storage
  rateDate: string;
  base?: string;
  source?: string;
};

export async function upsertFxRates(rows: FxRateInput[]): Promise<number> {
  if (rows.length === 0) return 0;
  await adminDb()
    .insert(fxRates)
    .values(
      rows.map((r) => ({
        base: r.base ?? 'EUR',
        quote: r.quote.toUpperCase(),
        rate: r.rate,
        rateDate: dateString.parse(r.rateDate),
        source: r.source ?? 'frankfurter/ecb',
      })),
    )
    .onConflictDoUpdate({
      target: [fxRates.base, fxRates.quote, fxRates.rateDate],
      set: { rate: sql`excluded.rate`, source: sql`excluded.source`, fetchedAt: sql`now()` },
    });
  return rows.length;
}

export type FxRate = { rate: string; rateDate: string; source: string };

/**
 * The EUR→quote rate effective on `onDate`: the most recent rate at or before
 * that date, looking back at most `maxLookbackDays` (ECB publishes business
 * days only — weekends and holidays use the prior rate, and the returned
 * rateDate says which one, so every conversion stays reproducible).
 */
export async function getFxRate(
  quote: string,
  onDate: string,
  opts: { base?: string; maxLookbackDays?: number } = {},
): Promise<FxRate | null> {
  dateString.parse(onDate);
  const base = opts.base ?? 'EUR';
  const lookback = opts.maxLookbackDays ?? 7;
  const earliest = new Date(Date.parse(onDate) - lookback * 86_400_000).toISOString().slice(0, 10);
  const [row] = await adminDb()
    .select()
    .from(fxRates)
    .where(
      and(
        eq(fxRates.base, base),
        eq(fxRates.quote, quote.toUpperCase()),
        lte(fxRates.rateDate, onDate),
        gte(fxRates.rateDate, earliest),
      ),
    )
    .orderBy(desc(fxRates.rateDate))
    .limit(1);
  return row ? { rate: row.rate, rateDate: row.rateDate, source: row.source } : null;
}
