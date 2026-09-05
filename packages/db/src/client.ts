import { drizzle } from 'drizzle-orm/node-postgres';
import pg from 'pg';
import { loadRootEnv } from '@grossline/core';
import * as schema from './schema';

loadRootEnv();

/**
 * Base (admin/migration) connection string. Under test, TEST_DATABASE_URL wins
 * so the suite never touches dev data; CI points DATABASE_URL at its test
 * database directly.
 */
export function adminDatabaseUrl(): string {
  const url =
    process.env.NODE_ENV === 'test'
      ? (process.env.TEST_DATABASE_URL ?? process.env.DATABASE_URL)
      : process.env.DATABASE_URL;
  if (!url) throw new Error('DATABASE_URL is not set');
  return url;
}

/**
 * Application connection string: same database, but as the `grossline_app`
 * role, which has no BYPASSRLS — row-level security applies to every query.
 */
export function appDatabaseUrl(): string {
  const explicit = process.env.APP_DATABASE_URL;
  if (explicit) return explicit;
  const url = new URL(adminDatabaseUrl());
  url.username = 'grossline_app';
  url.password = 'grossline_app';
  return url.toString();
}

let adminPoolSingleton: pg.Pool | null = null;
let appPoolSingleton: pg.Pool | null = null;

export function adminPool(): pg.Pool {
  adminPoolSingleton ??= new pg.Pool({ connectionString: adminDatabaseUrl(), max: 5 });
  return adminPoolSingleton;
}

export function appPool(): pg.Pool {
  appPoolSingleton ??= new pg.Pool({ connectionString: appDatabaseUrl(), max: 10 });
  return appPoolSingleton;
}

export function adminDb() {
  return drizzle(adminPool(), { schema });
}

export function appDb() {
  return drizzle(appPool(), { schema });
}

export async function closeDbPools(): Promise<void> {
  await Promise.all([adminPoolSingleton?.end(), appPoolSingleton?.end()]);
  adminPoolSingleton = null;
  appPoolSingleton = null;
}
