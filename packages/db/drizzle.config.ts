import { existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { defineConfig } from 'drizzle-kit';

// Inline .env loader — drizzle-kit bundles this config on its own, so keep it
// dependency-free rather than importing @grossline/core.
let dir = process.cwd();
for (;;) {
  const candidate = join(dir, '.env');
  if (existsSync(candidate)) {
    try {
      process.loadEnvFile(candidate);
    } catch {
      // ignore — env vars may be set directly (CI)
    }
    break;
  }
  const parent = dirname(dir);
  if (parent === dir) break;
  dir = parent;
}

export default defineConfig({
  dialect: 'postgresql',
  schema: './src/schema.ts',
  out: process.env.DRIZZLE_OUT ?? './drizzle',
  dbCredentials: {
    url: process.env.DATABASE_URL ?? 'postgres://grossline:grossline@localhost:5433/grossline',
  },
});
