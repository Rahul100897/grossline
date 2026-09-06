// Admin user lookups run on the admin connection: admin_users is the one
// table without tenant_id (it is the analyst's login, not tenant data) and
// the RLS app role has no access to it at all.
import { eq } from 'drizzle-orm';
import { adminDb } from './client';
import { adminUsers, auditLog } from './schema';

export type AdminUser = typeof adminUsers.$inferSelect;

export async function getAdminUserById(id: string): Promise<AdminUser | null> {
  const [row] = await adminDb().select().from(adminUsers).where(eq(adminUsers.id, id)).limit(1);
  return row ?? null;
}

export async function getAdminUserByEmail(email: string): Promise<AdminUser | null> {
  const [row] = await adminDb()
    .select()
    .from(adminUsers)
    .where(eq(adminUsers.email, email.toLowerCase()))
    .limit(1);
  return row ?? null;
}

export async function upsertAdminUser(input: {
  email: string;
  passwordHash: string;
  totpSecret: string;
}): Promise<AdminUser> {
  const [row] = await adminDb()
    .insert(adminUsers)
    .values({
      email: input.email.toLowerCase(),
      passwordHash: input.passwordHash,
      totpSecret: input.totpSecret,
    })
    .onConflictDoUpdate({
      target: adminUsers.email,
      set: { passwordHash: input.passwordHash, totpSecret: input.totpSecret },
    })
    .returning();
  if (!row) throw new Error('admin user upsert returned no row');
  return row;
}

export async function writeAuditLog(entry: {
  actor: string;
  action: string;
  tenantId?: string;
  subject?: string;
  metadata?: Record<string, unknown>;
}): Promise<void> {
  await adminDb().insert(auditLog).values({
    actor: entry.actor,
    action: entry.action,
    tenantId: entry.tenantId ?? null,
    subject: entry.subject ?? null,
    metadata: entry.metadata ?? null,
  });
}
