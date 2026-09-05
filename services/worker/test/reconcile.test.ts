import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { closeDbPools, seedDemoTenant } from '@grossline/db';
import { expectedFileSchema, reconcile, type ExpectedFile } from '../src/reconcile';

const FIXED_NOW = new Date('2026-09-05T12:00:00Z');
const expectedPath = join(
  dirname(fileURLToPath(import.meta.url)),
  '..', '..', '..',
  'docs', 'reconciliation', 'expected', 'demo-brand.json',
);

let expected: ExpectedFile;

beforeAll(async () => {
  await seedDemoTenant(FIXED_NOW);
  expected = expectedFileSchema.parse(JSON.parse(readFileSync(expectedPath, 'utf8')));
}, 120_000);

afterAll(async () => {
  await closeDbPools();
});

describe('reconciliation harness', () => {
  it('matches the demo tenant golden values exactly across three months', async () => {
    for (const month of ['2026-06', '2026-07', '2025-11']) {
      const report = await reconcile({ tenantIdOrSlug: 'demo-brand', month, expected, now: FIXED_NOW });
      expect(report.ok, `${month} should reconcile`).toBe(true);
      for (const row of report.rows) {
        expect(row.status, `${month} ${row.metric}`).toBe('within');
        expect(row.variance, `${month} ${row.metric}`).toBeCloseTo(0, 6);
      }
    }
  });

  it('flags an unexplained variance outside tolerance and fails the run', async () => {
    const skewed: ExpectedFile = {
      tenant: 'demo-brand',
      currency: 'USD',
      months: {
        '2026-06': {
          shopifyOrders: { value: 250 }, // ours is 225
          metaSpend: { value: 4262.03 },
        },
      },
    };
    const report = await reconcile({
      tenantIdOrSlug: 'demo-brand',
      month: '2026-06',
      expected: skewed,
      now: FIXED_NOW,
    });
    expect(report.ok).toBe(false);
    const orders = report.rows.find((r) => r.metric === 'shopifyOrders')!;
    expect(orders.status).toBe('outside');
    const meta = report.rows.find((r) => r.metric === 'metaSpend')!;
    expect(meta.status).toBe('within');
  });

  it('a written explanation turns an out-of-tolerance variance into a pass', async () => {
    const explained: ExpectedFile = {
      tenant: 'demo-brand',
      currency: 'USD',
      months: {
        '2026-06': {
          metaSpend: {
            value: 4600,
            explanation: 'Ads Manager viewed mid-restatement window; re-read after 28 days.',
          },
        },
      },
    };
    const report = await reconcile({
      tenantIdOrSlug: 'demo-brand',
      month: '2026-06',
      expected: explained,
      now: FIXED_NOW,
    });
    expect(report.ok).toBe(true);
    const meta = report.rows.find((r) => r.metric === 'metaSpend')!;
    expect(meta.status).toBe('explained');
    expect(meta.note).toMatch(/restatement/);
  });

  it('emits structural notes for recent months and mismatched timezones', async () => {
    // August 2026 ended days before FIXED_NOW → inside both restatement windows.
    const recent = await reconcile({
      tenantIdOrSlug: 'demo-brand',
      month: '2026-08',
      expected: null,
      now: FIXED_NOW,
    });
    expect(recent.structuralNotes.join('\n')).toMatch(/Meta restates the trailing 28 days/);
    expect(recent.structuralNotes.join('\n')).toMatch(/Google conversions restate/);

    // An old month carries no restatement notes.
    const old = await reconcile({
      tenantIdOrSlug: 'demo-brand',
      month: '2025-11',
      expected: null,
      now: FIXED_NOW,
    });
    expect(old.structuralNotes.join('\n')).not.toMatch(/Meta restates/);
  });

  it('metrics without a recorded platform figure are reported, not failed', async () => {
    const report = await reconcile({
      tenantIdOrSlug: 'demo-brand',
      month: '2026-05',
      expected,
      now: FIXED_NOW,
    });
    expect(report.ok).toBe(true);
    expect(report.rows.every((r) => r.status === 'no-expected')).toBe(true);
  });
});
