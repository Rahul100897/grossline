import { describe, expect, it } from 'vitest';
import {
  buildDigestText,
  isDigestDay,
  resolveDigestDay,
  type DigestConfig,
  type DigestInput,
} from '../src/reports/digest';

// task 5.B5 — the digest text is deterministic (golden), and the schedule is
// per-tenant.
const input: DigestInput = {
  tenantName: 'Demo Brand',
  currency: 'USD',
  windowStart: '2026-08-09',
  windowEnd: '2026-08-15',
  numbers: {
    netSalesMinor: 1_250_000,
    adSpendMinor: 420_000,
    mer: 2.98,
    orders: 140,
    aovMinor: 8929,
  },
  flags: ['Spend headroom — Whole account'],
};

describe('weekly digest text (task 5.B5)', () => {
  it('renders the five numbers and the flags', () => {
    const text = buildDigestText(input);
    expect(text).toContain('Demo Brand — weekly digest');
    expect(text).toContain('2026-08-09 to 2026-08-15');
    expect(text).toContain('Net sales:   USD 12,500.00');
    expect(text).toContain('Ad spend:    USD 4,200.00');
    expect(text).toContain('MER:         2.98');
    expect(text).toContain('Orders:      140');
    expect(text).toContain('AOV:         USD 89.29');
    expect(text).toContain('Flagged since the last digest:');
    expect(text).toContain('• Spend headroom — Whole account');
  });

  it('says nothing-new when there are no flags', () => {
    const text = buildDigestText({ ...input, flags: [] });
    expect(text).toContain('Flagged since the last digest: nothing new.');
  });

  it('is deterministic', () => {
    expect(buildDigestText(input)).toBe(buildDigestText(input));
  });
});

describe('digest schedule (task 5.B5)', () => {
  const config: DigestConfig = {
    enabled: true,
    defaultDay: 1, // Monday
    days: { 'tenant-thu': 4 }, // Thursday override
  };

  it('uses the default day for tenants without an override', () => {
    expect(resolveDigestDay(config, 'tenant-default')).toBe(1);
    // 2026-08-17 is a Monday (UTC).
    expect(isDigestDay(config, 'tenant-default', new Date('2026-08-17T00:00:00Z'))).toBe(true);
    expect(isDigestDay(config, 'tenant-default', new Date('2026-08-18T00:00:00Z'))).toBe(false);
  });

  it('respects a per-tenant override', () => {
    expect(resolveDigestDay(config, 'tenant-thu')).toBe(4);
    // 2026-08-20 is a Thursday (UTC).
    expect(isDigestDay(config, 'tenant-thu', new Date('2026-08-20T00:00:00Z'))).toBe(true);
    expect(isDigestDay(config, 'tenant-thu', new Date('2026-08-17T00:00:00Z'))).toBe(false);
  });

  it('sends nothing when digests are disabled', () => {
    const off: DigestConfig = { ...config, enabled: false };
    expect(isDigestDay(off, 'tenant-default', new Date('2026-08-17T00:00:00Z'))).toBe(false);
  });
});
