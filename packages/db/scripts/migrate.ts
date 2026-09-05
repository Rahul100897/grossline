import { existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { drizzle } from 'drizzle-orm/node-postgres';
import { migrate } from 'drizzle-orm/node-postgres/migrator';
import pg from 'pg';
import { loadRootEnv } from '@grossline/core';

loadRootEnv();

const packageRoot = join(dirname(fileURLToPath(import.meta.url)), '..');
const migrationsFolder = join(packageRoot, 'drizzle');

async function main() {
  if (!existsSync(join(migrationsFolder, 'meta', '_journal.json'))) {
    console.log('migrate: no migrations yet, nothing to do');
    return;
  }
  const url = process.env.DATABASE_URL;
  if (!url) throw new Error('DATABASE_URL is not set');
  const pool = new pg.Pool({ connectionString: url, max: 1 });
  try {
    await migrate(drizzle(pool), { migrationsFolder });
    console.log('migrate: done');
  } finally {
    await pool.end();
  }
}

main().catch((err) => {
  console.error('migrate: failed', err);
  process.exit(1);
});
