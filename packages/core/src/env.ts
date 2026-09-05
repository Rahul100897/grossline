import { existsSync } from 'node:fs';
import { dirname, join } from 'node:path';

/** Walk up from `startDir` looking for `name`; returns the full path or null. */
export function findUp(name: string, startDir: string): string | null {
  let dir = startDir;
  for (;;) {
    const candidate = join(dir, name);
    if (existsSync(candidate)) return candidate;
    const parent = dirname(dir);
    if (parent === dir) return null;
    dir = parent;
  }
}

let loaded = false;

/**
 * Load the repo-root .env into process.env (once). Values already present in
 * the environment win — CI sets real env vars and has no .env file.
 */
export function loadRootEnv(): void {
  if (loaded) return;
  loaded = true;
  const envFile = findUp('.env', process.cwd());
  if (!envFile) return;
  try {
    process.loadEnvFile(envFile);
  } catch {
    // Missing or unreadable .env is fine — env vars may be set directly.
  }
}
