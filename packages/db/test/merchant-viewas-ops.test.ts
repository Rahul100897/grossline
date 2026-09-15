import { describe, expect, it } from 'vitest';
import { hashPassword } from '@grossline/core';
import {
  createTenant,
  offboardTenant,
  createMerchantUser,
  createMembership,
  createMerchantSession,
  createViewAsSession,
  resolveMerchantSession,
  issueMerchantToken,
  consumeViewAsToken,
  getMerchantUserById,
} from '../src/index';

let n = 0;
async function tenant() {
  n += 1;
  return createTenant({
    name: `t${n}`,
    slug: `t-${n}-${Date.now()}`,
    reportingCurrency: 'USD',
    reportingTimezone: 'UTC',
    status: 'active',
  });
}
async function user(email: string) {
  return createMerchantUser({
    email,
    name: email,
    status: 'active',
    passwordHash: hashPassword('x-strong-password'),
  });
}

describe('view-as (Phase 8 §8.8)', () => {
  it('creates a read-only session pinned to a tenant the user is a member of', async () => {
    const t = await tenant();
    const u = await user(`va-${Date.now()}@example.com`);
    await createMembership({ userId: u.id, tenantId: t.id });

    const sid = await createViewAsSession(u.id, t.id);
    expect(sid).not.toBeNull();
    const s = (await resolveMerchantSession(sid!))!;
    expect(s.viewAs).toBe(true);
    expect(s.activeTenantId).toBe(t.id);
  });

  it('refuses to pin a tenant the user cannot access', async () => {
    const t = await tenant();
    const other = await tenant();
    const u = await user(`va2-${Date.now()}@example.com`);
    await createMembership({ userId: u.id, tenantId: t.id });
    expect(await createViewAsSession(u.id, other.id)).toBeNull();
  });

  it('the handoff token is single-use', async () => {
    const u = await user(`va3-${Date.now()}@example.com`);
    const token = await issueMerchantToken(u.id, 'viewas');
    expect(await consumeViewAsToken(token)).toBe(u.id);
    expect(await consumeViewAsToken(token)).toBeNull();
  });
});

describe('tenant deletion removes merchant access (Phase 8 §8.10)', () => {
  it('drops memberships, kills sessions, and deletes an orphaned user', async () => {
    const t = await tenant();
    const u = await user(`off-${Date.now()}@example.com`);
    await createMembership({ userId: u.id, tenantId: t.id });
    const sid = await createMerchantSession(u.id);
    expect(await resolveMerchantSession(sid)).not.toBeNull();

    await offboardTenant(t.id);

    expect(await resolveMerchantSession(sid)).toBeNull();
    expect(await getMerchantUserById(u.id)).toBeNull(); // orphaned → deleted
  });

  it('keeps a multi-tenant user but removes only the deleted tenant and logs them out', async () => {
    const t1 = await tenant();
    const t2 = await tenant();
    const u = await user(`off2-${Date.now()}@example.com`);
    await createMembership({ userId: u.id, tenantId: t1.id });
    await createMembership({ userId: u.id, tenantId: t2.id });
    const sid = await createMerchantSession(u.id);

    await offboardTenant(t1.id);

    // Session died (must re-login), but the user still exists with t2 access.
    expect(await resolveMerchantSession(sid)).toBeNull();
    const stillThere = await getMerchantUserById(u.id);
    expect(stillThere).not.toBeNull();
    const sid2 = await createMerchantSession(u.id);
    expect((await resolveMerchantSession(sid2))!.activeTenantId).toBe(t2.id);
  });
});
