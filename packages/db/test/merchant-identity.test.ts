import { describe, expect, it } from 'vitest';
import { hashPassword } from '@grossline/core';
import {
  createTenant,
  createMerchantUser,
  createMembership,
  createMerchantSession,
  resolveMerchantSession,
  setActiveTenant,
  revokeMerchantSession,
  disableMerchantUser,
  removeMembership,
  verifyMerchantLogin,
  setMerchantPassword,
} from '../src/index';

async function tenant(slug: string) {
  return createTenant({
    name: slug,
    slug,
    reportingCurrency: 'USD',
    reportingTimezone: 'UTC',
    status: 'active',
  });
}

async function activeUser(email: string, password = 'correct horse') {
  const u = await createMerchantUser({
    email,
    name: email,
    status: 'active',
    passwordHash: hashPassword(password),
  });
  return u;
}

describe('merchant identity + session isolation (Phase 8 §8.2)', () => {
  it('a session resolves only to a tenant the user is a member of', async () => {
    const a = await tenant('iso-a');
    const b = await tenant('iso-b');
    const user = await activeUser('a-only@example.com');
    await createMembership({ userId: user.id, tenantId: a.id });

    const sid = await createMerchantSession(user.id);
    const resolved = await resolveMerchantSession(sid);
    expect(resolved).not.toBeNull();
    expect(resolved!.memberships.map((m) => m.tenantId)).toEqual([a.id]);
    expect(resolved!.activeTenantId).toBe(a.id);

    // Direct request manipulation: try to switch to tenant B (no membership).
    const switched = await setActiveTenant(sid, b.id);
    expect(switched).toBe(false);
    const still = await resolveMerchantSession(sid);
    expect(still!.activeTenantId).toBe(a.id);
  });

  it('a multi-tenant user switches only among their memberships', async () => {
    const a = await tenant('multi-a');
    const b = await tenant('multi-b');
    const c = await tenant('multi-c'); // not a member
    const user = await activeUser('agency@example.com');
    await createMembership({ userId: user.id, tenantId: a.id });
    await createMembership({ userId: user.id, tenantId: b.id });

    const sid = await createMerchantSession(user.id);
    expect(await setActiveTenant(sid, b.id)).toBe(true);
    expect((await resolveMerchantSession(sid))!.activeTenantId).toBe(b.id);
    expect(await setActiveTenant(sid, c.id)).toBe(false); // refused
    expect((await resolveMerchantSession(sid))!.activeTenantId).toBe(b.id);
  });

  it('a user with no memberships cannot resolve a session at all', async () => {
    const user = await activeUser('orphan@example.com');
    const sid = await createMerchantSession(user.id);
    expect(await resolveMerchantSession(sid)).toBeNull();
  });

  it('revoking a session kills it immediately', async () => {
    const a = await tenant('revoke-a');
    const user = await activeUser('revoke@example.com');
    await createMembership({ userId: user.id, tenantId: a.id });
    const sid = await createMerchantSession(user.id);
    expect(await resolveMerchantSession(sid)).not.toBeNull();
    await revokeMerchantSession(sid);
    expect(await resolveMerchantSession(sid)).toBeNull();
  });

  it('disabling a user kills every live session on the next request', async () => {
    const a = await tenant('disable-a');
    const user = await activeUser('disable@example.com');
    await createMembership({ userId: user.id, tenantId: a.id });
    const sid = await createMerchantSession(user.id);
    expect(await resolveMerchantSession(sid)).not.toBeNull();
    await disableMerchantUser(user.id);
    expect(await resolveMerchantSession(sid)).toBeNull();
  });

  it('removing a membership terminates the pinned session (stale session cannot linger)', async () => {
    const a = await tenant('remove-a');
    const user = await activeUser('removed@example.com');
    await createMembership({ userId: user.id, tenantId: a.id });
    const sid = await createMerchantSession(user.id);
    expect(await resolveMerchantSession(sid)).not.toBeNull();
    await removeMembership(user.id, a.id);
    // Session revoked, and even a fresh resolve finds no membership.
    expect(await resolveMerchantSession(sid)).toBeNull();
  });

  it('login verifies the password and refuses disabled / password-less users', async () => {
    const user = await activeUser('login@example.com', 'right-password');
    expect(await verifyMerchantLogin('login@example.com', 'right-password')).not.toBeNull();
    expect(await verifyMerchantLogin('login@example.com', 'wrong-password')).toBeNull();
    expect(await verifyMerchantLogin('nobody@example.com', 'right-password')).toBeNull();

    // Invited-but-not-accepted (no password) cannot log in until they set one.
    const invited = await createMerchantUser({ email: 'invited@example.com', name: 'x' });
    expect(await verifyMerchantLogin('invited@example.com', 'anything')).toBeNull();
    await setMerchantPassword(invited.id, 'now-i-have-one');
    expect(await verifyMerchantLogin('invited@example.com', 'now-i-have-one')).not.toBeNull();

    await disableMerchantUser(user.id);
    expect(await verifyMerchantLogin('login@example.com', 'right-password')).toBeNull();
  });
});
