// Total ad spend for a month, converted to the reporting currency at each
// day's rate, with full FX traceability (every converted day records the rate
// and rate date used). A missing FX rate is a loud failure, never a zero.
import { and, eq, inArray } from 'drizzle-orm';
import { convertMinorUnits, decimalToMinorUnits, minorUnitExponent, type AdSpendForMonth } from '@grossline/core';
import { getFxRate, listConnections, schema, withTenant } from '@grossline/db';

export type FxTrace = { platform: string; from: string; to: string; date: string; rate: string; rateDate: string };

async function eurRateFor(currency: string, date: string): Promise<{ rate: number; rateDate: string }> {
  if (currency === 'EUR') return { rate: 1, rateDate: date };
  const row = await getFxRate(currency, date);
  if (!row) {
    throw new Error(
      `no FX rate for ${currency} on ${date} (run pnpm fx:pull; ECB rates lag weekends by design)`,
    );
  }
  return { rate: Number(row.rate), rateDate: row.rateDate };
}

/** Convert one amount on one date, recording the rate used. */
export async function convertMinorOnDate(
  platform: string,
  amountMinor: number,
  from: string,
  to: string,
  date: string,
  trace: FxTrace[],
): Promise<number> {
  if (from === to || amountMinor === 0) return amountMinor;
  const [fromRate, toRate] = [await eurRateFor(from, date), await eurRateFor(to, date)];
  const converted = convertMinorUnits({
    amountMinor,
    from,
    to,
    eurRates: { [from]: fromRate.rate, [to]: toRate.rate },
    rateDate: fromRate.rateDate,
  });
  trace.push({ platform, from, to, date, rate: converted.rate, rateDate: converted.rateDate });
  return converted.amountMinor;
}

async function convertDaily(
  platform: string,
  byDate: Map<string, number>,
  from: string,
  to: string,
  trace: FxTrace[],
): Promise<number> {
  let total = 0;
  for (const [date, amountMinor] of byDate) {
    if (amountMinor === 0) continue;
    if (from === to) {
      total += amountMinor;
      continue;
    }
    const [fromRate, toRate] = [await eurRateFor(from, date), await eurRateFor(to, date)];
    const converted = convertMinorUnits({
      amountMinor,
      from,
      to,
      eurRates: { [from]: fromRate.rate, [to]: toRate.rate },
      rateDate: fromRate.rateDate,
    });
    total += converted.amountMinor;
    trace.push({ platform, from, to, date, rate: converted.rate, rateDate: converted.rateDate });
  }
  return total;
}

export async function loadAdSpendForMonth(
  tenantId: string,
  dateStrings: string[],
  reportingCurrency: string,
): Promise<AdSpendForMonth> {
  const connections = await listConnections(tenantId);
  const currencyByConnection = new Map(connections.map((c) => [c.id, c.accountCurrency ?? reportingCurrency]));
  const trace: FxTrace[] = [];
  const byPlatform: Record<string, number> = {};

  // Meta: account-level daily rows; spend is a decimal string in account currency.
  const metaRows = await withTenant(tenantId, (tx) =>
    tx
      .select({
        payload: schema.rawMetaInsights.payload,
        date: schema.rawMetaInsights.date,
        connectionId: schema.rawMetaInsights.connectionId,
      })
      .from(schema.rawMetaInsights)
      .where(
        and(eq(schema.rawMetaInsights.level, 'account'), inArray(schema.rawMetaInsights.date, dateStrings)),
      ),
  );
  const metaByCurrency = new Map<string, Map<string, number>>();
  for (const row of metaRows) {
    const payload = row.payload as { spend?: string; account_currency?: string };
    if (!payload.spend) continue;
    const currency = payload.account_currency ?? currencyByConnection.get(row.connectionId) ?? reportingCurrency;
    const byDate = metaByCurrency.get(currency) ?? new Map<string, number>();
    byDate.set(row.date, (byDate.get(row.date) ?? 0) + decimalToMinorUnits(payload.spend, currency));
    metaByCurrency.set(currency, byDate);
  }
  let metaTotal = 0;
  for (const [currency, byDate] of metaByCurrency) {
    metaTotal += await convertDaily('meta', byDate, currency, reportingCurrency, trace);
  }
  if (metaTotal > 0 || metaRows.length > 0) byPlatform.meta = metaTotal;

  // Google: campaign daily rows; cost_micros in the account currency.
  const googleRows = await withTenant(tenantId, (tx) =>
    tx
      .select({
        payload: schema.rawGoogleAdsInsights.payload,
        date: schema.rawGoogleAdsInsights.date,
        connectionId: schema.rawGoogleAdsInsights.connectionId,
      })
      .from(schema.rawGoogleAdsInsights)
      .where(inArray(schema.rawGoogleAdsInsights.date, dateStrings)),
  );
  const googleByCurrency = new Map<string, Map<string, number>>();
  for (const row of googleRows) {
    const micros = (row.payload as { metrics?: { costMicros?: string } }).metrics?.costMicros;
    if (!micros) continue;
    const currency = currencyByConnection.get(row.connectionId) ?? reportingCurrency;
    const minor = Math.round((Number(micros) / 1_000_000) * 10 ** minorUnitExponent(currency));
    const byDate = googleByCurrency.get(currency) ?? new Map<string, number>();
    byDate.set(row.date, (byDate.get(row.date) ?? 0) + minor);
    googleByCurrency.set(currency, byDate);
  }
  let googleTotal = 0;
  for (const [currency, byDate] of googleByCurrency) {
    googleTotal += await convertDaily('google_ads', byDate, currency, reportingCurrency, trace);
  }
  if (googleTotal > 0 || googleRows.length > 0) byPlatform.google_ads = googleTotal;

  return {
    totalMinor: metaTotal + googleTotal,
    byPlatform,
    ...(trace.length > 0 ? { conversion: { rates: trace } } : {}),
  };
}
