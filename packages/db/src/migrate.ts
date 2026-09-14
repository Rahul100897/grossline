import { existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { drizzle } from 'drizzle-orm/node-postgres';
import { migrate } from 'drizzle-orm/node-postgres/migrator';
import pg from 'pg';

const migrationsFolder = join(dirname(fileURLToPath(import.meta.url)), '..', 'drizzle');

/**
 * Ensure the database named in `url` exists, creating it if missing (connects to
 * the server's default `postgres` database to do so). Replaces the docker
 * initdb script that created `grossline_test` — the app and the test suite now
 * provision their databases without a host bind mount, which wedged on macOS
 * file sharing (see docs/decisions.md). Safe to run repeatedly.
 */
export async function ensureDatabase(url: string): Promise<void> {
  const target = new URL(url);
  const dbName = decodeURIComponent(target.pathname.replace(/^\//, ''));
  if (!dbName) return;
  // Our database names are simple identifiers; refuse anything else rather than
  // interpolate it into DDL (identifiers can't be parameterized).
  if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(dbName)) {
    throw new Error(`unsafe database name: ${dbName}`);
  }
  const admin = new URL(url);
  admin.pathname = '/postgres';
  const pool = new pg.Pool({ connectionString: admin.toString(), max: 1 });
  try {
    const { rows } = await pool.query('select 1 from pg_database where datname = $1', [dbName]);
    if (rows.length === 0) await pool.query(`create database "${dbName}"`);
  } finally {
    await pool.end();
  }
}

/** Apply all pending migrations to `url`. Safe to run repeatedly. */
export async function runMigrations(url: string): Promise<void> {
  if (!existsSync(join(migrationsFolder, 'meta', '_journal.json'))) return;
  const pool = new pg.Pool({ connectionString: url, max: 1 });
  try {
    await migrate(drizzle(pool), { migrationsFolder });
  } finally {
    await pool.end();
  }
}
