// The demo portal account (Phase 8 §8.1): a read-only merchant login bound to
// the demo tenant, with credentials safe to share on a call. Idempotent, and the
// password is reset to the known value every run so a nightly reset returns it
// to a clean state. Flagged is_demo: it can never see a real tenant.
import { eq } from 'drizzle-orm';
import { hashPassword } from '@grossline/core';
import { adminDb } from './client';
import { getTenantBySlug } from './admin';
import { seedDemoTenant } from './seed-demo';
import { merchantMemberships, merchantUsers, merchantSessions } from './schema';
import { revokeAllSessionsForUser } from './merchant';

export const DEMO_PORTAL_EMAIL = 'demo@getgrossline.com';

/** The shareable demo password. Overridable, with a stable default. */
export function demoPortalPassword(): string {
  return process.env.DEMO_PORTAL_PASSWORD ?? 'explore-grossline';
}

export type DemoMerchantSeed = {
  email: string;
  password: string;
  userId: string;
  tenantId: string;
};

export async function seedDemoMerchant(): Promise<DemoMerchantSeed> {
  const demoTenant =
    (await getTenantBySlug('demo-brand')) ??
    (await seedDemoTenant().then(() => getTenantBySlug('demo-brand')));
  if (!demoTenant) throw new Error('demo tenant not found and could not be seeded');

  const password = demoPortalPassword();
  const passwordHash = hashPassword(password);

  const [existing] = await adminDb()
    .select()
    .from(merchantUsers)
    .where(eq(merchantUsers.email, DEMO_PORTAL_EMAIL));

  let userId: string;
  if (existing) {
    await adminDb()
      .update(merchantUsers)
      .set({ passwordHash, status: 'active', isDemo: true, name: 'Demo (read-only)' })
      .where(eq(merchantUsers.id, existing.id));
    userId = existing.id;
  } else {
    const [row] = await adminDb()
      .insert(merchantUsers)
      .values({
        email: DEMO_PORTAL_EMAIL,
        name: 'Demo (read-only)',
        passwordHash,
        status: 'active',
        isDemo: true,
      })
      .returning({ id: merchantUsers.id });
    userId = row!.id;
  }

  await adminDb()
    .insert(merchantMemberships)
    .values({ userId, tenantId: demoTenant.id, role: 'viewer' })
    .onConflictDoNothing({ target: [merchantMemberships.userId, merchantMemberships.tenantId] });

  return { email: DEMO_PORTAL_EMAIL, password, userId, tenantId: demoTenant.id };
}

/**
 * Nightly reset (§8.1): re-seed the deterministic demo tenant, reset the demo
 * login to its known password, and drop every demo session so a prospect cannot
 * leave it in a changed state for the next one.
 */
export async function resetDemo(): Promise<DemoMerchantSeed> {
  await seedDemoTenant();
  const seed = await seedDemoMerchant();
  await revokeAllSessionsForUser(seed.userId);
  // Demo sessions are throwaway; clear the revoked rows too.
  await adminDb().delete(merchantSessions).where(eq(merchantSessions.userId, seed.userId));
  return seed;
}
