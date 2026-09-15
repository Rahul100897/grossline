// Phase 8 §8.9 — the point of the part. Prove that a merchant session can only
// reach its own tenant's data through the exact path the portal uses: resolve
// the session → get its active tenant → query the tenant-scoped helpers. The
// five vectors: direct call, parameter/URL, stale session after membership
// removal, and a multi-tenant user switching context. (Postgres RLS is the
// second net and is proven in rls.test.ts / tenant-isolation.test.ts.)
import { beforeAll, describe, expect, it } from 'vitest';
import { hashPassword } from '@grossline/core';
import {
  createTenant,
  createMerchantUser,
  createMembership,
  createMerchantSession,
  resolveMerchantSession,
  setActiveTenant,
  removeMembership,
  upsertReportSnapshot,
  markReportApproved,
  markReportSent,
  getReport,
  listReports,
  upsertMetricValues,
  listMetricValuesForPeriod,
} from '../src/index';

const PERIOD = '2026-08-01';
let A: string;
let B: string;

async function sendReport(tenantId: string, marker: string) {
  const r = await upsertReportSnapshot(tenantId, PERIOD, { tenantName: marker, marker });
  await markReportApproved(tenantId, r.id);
  await markReportSent(tenantId, r.id, [`owner@${marker}.example`]);
}

async function member(email: string, tenantIds: string[]) {
  const u = await createMerchantUser({
    email,
    name: email,
    status: 'active',
    passwordHash: hashPassword('a-strong-password'),
  });
  for (const t of tenantIds) await createMembership({ userId: u.id, tenantId: t });
  return u;
}

beforeAll(async () => {
  A = (
    await createTenant({
      name: 'A',
      slug: `iso-a-${Date.now()}`,
      reportingCurrency: 'USD',
      reportingTimezone: 'UTC',
      status: 'active',
    })
  ).id;
  B = (
    await createTenant({
      name: 'B',
      slug: `iso-b-${Date.now()}`,
      reportingCurrency: 'USD',
      reportingTimezone: 'UTC',
      status: 'active',
    })
  ).id;
  await sendReport(A, 'A-report');
  await sendReport(B, 'B-report');
  await upsertMetricValues(A, null, [
    { metric: 'net_sales', grain: 'month', period: PERIOD, value: 100, currency: 'USD' },
  ]);
  await upsertMetricValues(B, null, [
    { metric: 'net_sales', grain: 'month', period: PERIOD, value: 999, currency: 'USD' },
  ]);
});

describe('portal data isolation (Phase 8 §8.9)', () => {
  it('direct call: a single-tenant session reads only its own report and metrics', async () => {
    const u = await member(`a-only-${Date.now()}@example.com`, [A]);
    const sid = await createMerchantSession(u.id);
    const s = (await resolveMerchantSession(sid))!;
    expect(s.activeTenantId).toBe(A);

    // The portal only ever queries with s.activeTenantId.
    const report = await getReport(s.activeTenantId, PERIOD);
    expect((report!.snapshot as { marker: string }).marker).toBe('A-report');
    const all = await listReports(s.activeTenantId);
    expect(all.every((r) => (r.snapshot as { marker: string }).marker === 'A-report')).toBe(true);
    const metrics = await listMetricValuesForPeriod(s.activeTenantId, 'month', PERIOD);
    expect(metrics.find((m) => m.metric === 'net_sales')?.value).toBe('100.00000000');
  });

  it('parameter/URL tamper: cannot switch the active tenant to a non-member tenant', async () => {
    const u = await member(`a-only2-${Date.now()}@example.com`, [A]);
    const sid = await createMerchantSession(u.id);
    expect(await setActiveTenant(sid, B)).toBe(false);
    const s = (await resolveMerchantSession(sid))!;
    expect(s.activeTenantId).toBe(A);
    // Even the report route's getReport(activeTenantId, period) stays on A.
    expect((await getReport(s.activeTenantId, PERIOD))!.snapshot).toMatchObject({
      marker: 'A-report',
    });
  });

  it('stale session after membership removal cannot reach the removed tenant', async () => {
    const u = await member(`ab-${Date.now()}@example.com`, [A, B]);
    const sid = await createMerchantSession(u.id);
    expect(await setActiveTenant(sid, B)).toBe(true);
    expect((await resolveMerchantSession(sid))!.activeTenantId).toBe(B);
    // Remove B → the pinned session dies; it cannot serve B (or anything) again.
    await removeMembership(u.id, B);
    expect(await resolveMerchantSession(sid)).toBeNull();
  });

  it('multi-tenant switch: each context reads only that tenant, never the other', async () => {
    const u = await member(`agency-${Date.now()}@example.com`, [A, B]);
    const sid = await createMerchantSession(u.id);

    expect(await setActiveTenant(sid, A)).toBe(true);
    let s = (await resolveMerchantSession(sid))!;
    expect((await getReport(s.activeTenantId, PERIOD))!.snapshot).toMatchObject({
      marker: 'A-report',
    });

    expect(await setActiveTenant(sid, B)).toBe(true);
    s = (await resolveMerchantSession(sid))!;
    expect((await getReport(s.activeTenantId, PERIOD))!.snapshot).toMatchObject({
      marker: 'B-report',
    });
    const metrics = await listMetricValuesForPeriod(s.activeTenantId, 'month', PERIOD);
    expect(metrics.find((m) => m.metric === 'net_sales')?.value).toBe('999.00000000');
  });
});
