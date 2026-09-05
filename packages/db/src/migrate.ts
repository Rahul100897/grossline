import { existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { drizzle } from 'drizzle-orm/node-postgres';
import { migrate } from 'drizzle-orm/node-postgres/migrator';
import pg from 'pg';

const migrationsFolder = join(dirname(fileURLToPath(import.meta.url)), '..', 'drizzle');

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
