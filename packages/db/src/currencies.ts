// Which currencies the FX fetcher needs rates for: every reporting currency,
// store currency and ad account billing currency in use. Cross-tenant by
// nature (it feeds a global reference table), so it runs on the admin
// connection like the other explicit admin reads.
import { sql } from 'drizzle-orm';
import { adminDb } from './client';

export async function listCurrenciesInUse(): Promise<string[]> {
  const result = await adminDb().execute(sql`
    SELECT reporting_currency AS currency FROM tenants
    UNION
    SELECT store_currency FROM stores
    UNION
    SELECT account_currency FROM connections WHERE account_currency IS NOT NULL
  `);
  const rows = result.rows as { currency: string }[];
  return [...new Set(rows.map((r) => r.currency.toUpperCase()))].sort();
}
