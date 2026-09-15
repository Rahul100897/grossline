// Phase 8 §8.9 guard: the suite must fail if a new portal route is added without
// scoping. Every page and route handler under app/(app) must resolve the session
// (scope() / requirePortalSession / getPortalSession) — that is the only way it
// gets a tenant, and no data query may run without one.
import { describe, expect, it } from 'vitest';
import { readFileSync, readdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join, relative } from 'node:path';

const here = dirname(fileURLToPath(import.meta.url));
const appDir = join(here, '..', 'app', '(app)');

function routeFiles(dir: string): string[] {
  const out: string[] = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) out.push(...routeFiles(full));
    else if (/^(page|route)\.tsx?$/.test(entry.name)) out.push(full);
  }
  return out;
}

const RESOLVES_SESSION = /\bscope\(|requirePortalSession|getPortalSession/;

describe('every portal route resolves the session (Phase 8 §8.9 guard)', () => {
  const files = routeFiles(appDir);

  it('finds the portal routes to check', () => {
    expect(files.length).toBeGreaterThan(3);
  });

  for (const file of files) {
    const name = relative(appDir, file);
    it(`${name} resolves the session before returning data`, () => {
      const src = readFileSync(file, 'utf8');
      expect(
        RESOLVES_SESSION.test(src),
        `${name} must call scope()/requirePortalSession/getPortalSession`,
      ).toBe(true);
    });
  }
});
