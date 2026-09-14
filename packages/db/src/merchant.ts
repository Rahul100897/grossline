// Merchant portal identity + sessions (Phase 8). These are identity tables with
// no tenant_id of their own (like admin_users), so they use the admin pool.
// The one rule that matters: a session's tenant is resolved here from the user's
// memberships — never taken from anything the client sends.
import { and, eq, gt, isNull, lt } from 'drizzle-orm';
import { hashPassword, verifyPassword } from '@grossline/core';
import { adminDb } from './client';
import { merchantMemberships, merchantSessions, merchantUsers, tenants } from './schema';

export type MerchantUser = typeof merchantUsers.$inferSelect;
export type MerchantMembership = typeof merchantMemberships.$inferSelect;
export type MerchantSession = typeof merchantSessions.$inferSelect;
export type MerchantRole = 'owner' | 'viewer';

/** A resolved session: the user, their memberships, and the one active tenant.
 *  Everything the portal is allowed to act on comes from here. */
export type ResolvedMerchantSession = {
  sessionId: string;
  user: MerchantUser;
  memberships: { tenantId: string; tenantName: string; role: MerchantRole }[];
  activeTenantId: string;
  activeRole: MerchantRole;
};

const SESSION_TTL_MS = 12 * 60 * 60 * 1000; // 12 hours

// ---- users ----

export async function getMerchantUserByEmail(email: string): Promise<MerchantUser | null> {
  const [row] = await adminDb()
    .select()
    .from(merchantUsers)
    .where(eq(merchantUsers.email, email.toLowerCase()));
  return row ?? null;
}

export async function getMerchantUserById(id: string): Promise<MerchantUser | null> {
  const [row] = await adminDb().select().from(merchantUsers).where(eq(merchantUsers.id, id));
  return row ?? null;
}

export async function createMerchantUser(input: {
  email: string;
  name: string;
  isDemo?: boolean;
  status?: 'invited' | 'active';
  passwordHash?: string | null;
}): Promise<MerchantUser> {
  const [row] = await adminDb()
    .insert(merchantUsers)
    .values({
      email: input.email.toLowerCase(),
      name: input.name,
      isDemo: input.isDemo ?? false,
      status: input.status ?? 'invited',
      passwordHash: input.passwordHash ?? null,
    })
    .returning();
  if (!row) throw new Error('merchant user insert returned no row');
  return row;
}

/** Set a password and activate the user (invite acceptance / reset). */
export async function setMerchantPassword(userId: string, password: string): Promise<void> {
  await adminDb()
    .update(merchantUsers)
    .set({ passwordHash: hashPassword(password), status: 'active' })
    .where(eq(merchantUsers.id, userId));
}

/** Disable a user and kill every live session immediately (§8.4). */
export async function disableMerchantUser(userId: string): Promise<void> {
  await adminDb()
    .update(merchantUsers)
    .set({ status: 'disabled' })
    .where(eq(merchantUsers.id, userId));
  await revokeAllSessionsForUser(userId);
}

// ---- memberships ----

export async function createMembership(input: {
  userId: string;
  tenantId: string;
  role?: MerchantRole;
  invitedBy?: string | null;
}): Promise<MerchantMembership> {
  const [row] = await adminDb()
    .insert(merchantMemberships)
    .values({
      userId: input.userId,
      tenantId: input.tenantId,
      role: input.role ?? 'viewer',
      invitedBy: input.invitedBy ?? null,
    })
    .onConflictDoNothing({ target: [merchantMemberships.userId, merchantMemberships.tenantId] })
    .returning();
  if (row) return row;
  const [existing] = await adminDb()
    .select()
    .from(merchantMemberships)
    .where(
      and(
        eq(merchantMemberships.userId, input.userId),
        eq(merchantMemberships.tenantId, input.tenantId),
      ),
    );
  if (!existing) throw new Error('membership upsert failed');
  return existing;
}

async function membershipsForUser(
  userId: string,
): Promise<{ tenantId: string; tenantName: string; role: MerchantRole }[]> {
  const rows = await adminDb()
    .select({
      tenantId: merchantMemberships.tenantId,
      tenantName: tenants.name,
      role: merchantMemberships.role,
    })
    .from(merchantMemberships)
    .innerJoin(tenants, eq(tenants.id, merchantMemberships.tenantId))
    .where(eq(merchantMemberships.userId, userId));
  return rows.map((r) => ({ tenantId: r.tenantId, tenantName: r.tenantName, role: r.role }));
}

/** Remove all of a user's access to a tenant and kill affected sessions. Used by
 *  admin revoke and by tenant deletion (§8.10). */
export async function removeMembership(userId: string, tenantId: string): Promise<void> {
  await adminDb()
    .delete(merchantMemberships)
    .where(and(eq(merchantMemberships.userId, userId), eq(merchantMemberships.tenantId, tenantId)));
  // A session pinned to that tenant, or a user who now has no memberships, must
  // stop resolving — revoke the user's sessions; the next login re-scopes.
  await revokeAllSessionsForUser(userId);
}

// ---- sessions ----

export async function createMerchantSession(userId: string): Promise<string> {
  const [row] = await adminDb()
    .insert(merchantSessions)
    .values({ userId, expiresAt: new Date(Date.now() + SESSION_TTL_MS) })
    .returning({ id: merchantSessions.id });
  if (!row) throw new Error('session insert returned no row');
  return row.id;
}

export async function revokeMerchantSession(sessionId: string): Promise<void> {
  await adminDb()
    .update(merchantSessions)
    .set({ revokedAt: new Date() })
    .where(and(eq(merchantSessions.id, sessionId), isNull(merchantSessions.revokedAt)));
}

export async function revokeAllSessionsForUser(userId: string): Promise<void> {
  await adminDb()
    .update(merchantSessions)
    .set({ revokedAt: new Date() })
    .where(and(eq(merchantSessions.userId, userId), isNull(merchantSessions.revokedAt)));
}

/**
 * Resolve a session id to its user, memberships and active tenant — or null if
 * the session is missing, revoked, expired, or the user is not active. This is
 * the single source of a merchant's identity and tenant scope; nothing the
 * client sends is trusted here.
 */
export async function resolveMerchantSession(
  sessionId: string,
): Promise<ResolvedMerchantSession | null> {
  const [session] = await adminDb()
    .select()
    .from(merchantSessions)
    .where(
      and(
        eq(merchantSessions.id, sessionId),
        isNull(merchantSessions.revokedAt),
        gt(merchantSessions.expiresAt, new Date()),
      ),
    );
  if (!session) return null;

  const user = await getMerchantUserById(session.userId);
  if (!user || user.status !== 'active') return null;

  const memberships = await membershipsForUser(user.id);
  if (memberships.length === 0) return null; // no tenant to resolve → no access

  // Active tenant comes from the session's stored choice *only if* it is still a
  // real membership; otherwise the first membership. Never from client input.
  const chosen = memberships.find((m) => m.tenantId === session.activeTenantId);
  const active = chosen ?? memberships[0]!;

  await adminDb()
    .update(merchantSessions)
    .set({ lastSeenAt: new Date() })
    .where(eq(merchantSessions.id, session.id));

  return {
    sessionId: session.id,
    user,
    memberships,
    activeTenantId: active.tenantId,
    activeRole: active.role,
  };
}

/** Switch the active tenant for a multi-tenant user — validated against their
 *  memberships, so a tampered value cannot select a tenant they can't access. */
export async function setActiveTenant(sessionId: string, tenantId: string): Promise<boolean> {
  const resolved = await resolveMerchantSession(sessionId);
  if (!resolved) return false;
  if (!resolved.memberships.some((m) => m.tenantId === tenantId)) return false;
  await adminDb()
    .update(merchantSessions)
    .set({ activeTenantId: tenantId })
    .where(eq(merchantSessions.id, sessionId));
  return true;
}

/**
 * Verify email + password for login. Returns the user on success. Does not
 * create a session (the caller rotates + issues the cookie). Constant-ish:
 * always runs a hash comparison so a missing user and a wrong password look
 * alike in timing.
 */
export async function verifyMerchantLogin(
  email: string,
  password: string,
): Promise<MerchantUser | null> {
  const user = await getMerchantUserByEmail(email);
  const stored =
    user?.passwordHash ??
    // A dummy scrypt hash to keep timing similar when the user is absent.
    'scrypt$16384$8$1$AAAAAAAAAAAAAAAAAAAAAA==$AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA=';
  const ok = verifyPassword(password, stored);
  if (!user || user.status !== 'active' || user.passwordHash === null || !ok) return null;
  return user;
}

/** Housekeeping: drop sessions long past expiry (revoked ones stay as a record
 *  until this sweeps them). Callable from a nightly job. */
export async function purgeExpiredMerchantSessions(before = new Date()): Promise<void> {
  await adminDb().delete(merchantSessions).where(lt(merchantSessions.expiresAt, before));
}
