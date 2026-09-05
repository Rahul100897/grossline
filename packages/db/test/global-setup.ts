import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { drizzle } from 'drizzle-orm/node-postgres';
import { migrate } from 'drizzle-orm/node-postgres/migrator';
import pg from 'pg';
import { loadRootEnv } from '@grossline/core';

export default async function setup(): Promise<void> {
  loadRootEnv();
  const url =
    process.env.TEST_DATABASE_URL ??
    process.env.DATABASE_URL ??
    'postgres://grossline:grossline@localhost:5433/grossline_test';

  const migrationsFolder = join(dirname(fileURLToPath(import.meta.url)), '..', 'drizzle');
  const pool = new pg.Pool({ connectionString: url, max: 1 });
  try {
    await migrate(drizzle(pool), { migrationsFolder });
    // Clean slate for every run. Order-independent thanks to CASCADE.
    await pool.query(
      'TRUNCATE audit_log, sync_runs, connections, credentials, stores, tenants, admin_users RESTART IDENTITY CASCADE',
    );
  } finally {
    await pool.end();
  }
}
