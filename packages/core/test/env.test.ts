import { mkdtempSync, writeFileSync, mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { findUp } from '../src/env';

describe('findUp', () => {
  it('finds a file in an ancestor directory', () => {
    const root = mkdtempSync(join(tmpdir(), 'grossline-env-'));
    writeFileSync(join(root, '.env'), 'X=1\n');
    const nested = join(root, 'a', 'b');
    mkdirSync(nested, { recursive: true });
    expect(findUp('.env', nested)).toBe(join(root, '.env'));
  });

  it('returns null when nothing is found', () => {
    const root = mkdtempSync(join(tmpdir(), 'grossline-env-'));
    expect(findUp('definitely-not-here.xyz', root)).toBeNull();
  });
});
