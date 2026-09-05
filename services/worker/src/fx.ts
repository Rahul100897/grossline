// Daily FX rates from Frankfurter (ECB reference rates — free, keyless,
// business days only). Base EUR; cross rates are derived at conversion time.
import { z } from 'zod';
import { logger } from '@grossline/core';
import { listCurrenciesInUse, upsertFxRates } from '@grossline/db';
import { fetchWithRetry } from './connectors/http';

const timeseriesSchema = z.object({
  base: z.literal('EUR'),
  start_date: z.string(),
  end_date: z.string(),
  rates: z.record(
    z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
    z.record(z.string(), z.number()),
  ),
});

export function frankfurterBaseUrl(): string {
  return process.env.FRANKFURTER_BASE_URL || 'https://api.frankfurter.dev/v1';
}

export async function fetchAndStoreFxRates(opts: {
  start: string; // YYYY-MM-DD
  end: string;
  symbols?: string[];
  fetchImpl?: typeof fetch;
}): Promise<number> {
  const symbols = (opts.symbols ?? (await listCurrenciesInUse())).filter((c) => c !== 'EUR');
  if (symbols.length === 0) return 0;

  const url = `${frankfurterBaseUrl()}/${opts.start}..${opts.end}?symbols=${symbols.join(',')}`;
  const res = await fetchWithRetry(url, { method: 'GET' }, { fetchImpl: opts.fetchImpl ?? fetch });
  if (!res.ok) throw new Error(`frankfurter: HTTP ${res.status}`);
  const data = timeseriesSchema.parse(await res.json());

  const rows = Object.entries(data.rates).flatMap(([rateDate, byCurrency]) =>
    Object.entries(byCurrency).map(([quote, rate]) => ({
      quote,
      rate: String(rate),
      rateDate,
    })),
  );
  await upsertFxRates(rows);
  logger.info('fx rates stored', {
    start: opts.start,
    end: opts.end,
    symbols,
    rows: rows.length,
  });
  return rows.length;
}

/** The trailing window the nightly job refreshes (covers late ECB publishes). */
export async function pullRecentFxRates(fetchImpl?: typeof fetch): Promise<number> {
  const end = new Date().toISOString().slice(0, 10);
  const start = new Date(Date.now() - 7 * 86_400_000).toISOString().slice(0, 10);
  return fetchAndStoreFxRates({ start, end, fetchImpl });
}
