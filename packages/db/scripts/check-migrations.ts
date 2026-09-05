// Fails when src/schema.ts has changes that are not captured in a generated
// migration. Works by copying the migrations folder to a temp dir and running
// `drizzle-kit generate` against the copy: any new .sql file means drift.
import { execSync } from 'node:child_process';
import { cpSync, existsSync, mkdtempSync, readdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const packageRoot = join(dirname(fileURLToPath(import.meta.url)), '..');
const migrationsFolder = join(packageRoot, 'drizzle');

const sqlFiles = (dir: string): string[] =>
  existsSync(dir) ? readdirSync(dir).filter((f) => f.endsWith('.sql')) : [];

const tempOut = mkdtempSync(join(tmpdir(), 'grossline-drizzle-check-'));
try {
  if (existsSync(migrationsFolder)) {
    cpSync(migrationsFolder, tempOut, { recursive: true });
  }
  const before = sqlFiles(tempOut).length;
  execSync('pnpm exec drizzle-kit generate --name drift_check', {
    cwd: packageRoot,
    env: { ...process.env, DRIZZLE_OUT: tempOut },
    stdio: 'pipe',
  });
  const after = sqlFiles(tempOut).length;
  if (after > before) {
    console.error(
      'check-migrations: src/schema.ts has changes with no generated migration.\n' +
        'Run `pnpm --filter @grossline/db generate` and commit the result.',
    );
    process.exit(1);
  }
  console.log('check-migrations: migrations are up to date');
} finally {
  rmSync(tempOut, { recursive: true, force: true });
}
