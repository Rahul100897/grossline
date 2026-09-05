import { loadRootEnv } from '@grossline/core';
import { runMigrations } from '@grossline/db';

// Worker tests hit the same test database as the db package's suite; make sure
// migrations are applied even when this suite runs on its own.
export default async function setup(): Promise<void> {
  loadRootEnv();
  const url =
    process.env.TEST_DATABASE_URL ??
    process.env.DATABASE_URL ??
    'postgres://grossline:grossline@localhost:5433/grossline_test';
  await runMigrations(url);
}
