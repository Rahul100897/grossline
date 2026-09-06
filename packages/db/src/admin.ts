// Explicit cross-tenant operations for the admin console and operational
// scripts. These run on the admin connection, which RLS does not constrain —
// which is exactly why each one is a named function with a narrow shape
// instead of an exported database handle.
import { asc, eq } from 'drizzle-orm';
import { z } from 'zod';
import { adminDb } from './client';
import { tenants } from './schema';

const createTenantSchema = z.object({
  name: z.string().min(1),
  slug: z
    .string()
    .min(1)
    .regex(/^[a-z0-9-]+$/, 'slug must be lowercase kebab-case'),
  reportingCurrency: z.string().length(3),
  reportingTimezone: z.string().min(1),
  plan: z.string().optional(),
  status: z.enum(['onboarding', 'active', 'paused', 'churned']).optional(),
  isDemo: z.boolean().optional(),
});

export type CreateTenantInput = z.input<typeof createTenantSchema>;
export type Tenant = typeof tenants.$inferSelect;

export async function createTenant(input: CreateTenantInput): Promise<Tenant> {
  const data = createTenantSchema.parse(input);
  const [row] = await adminDb().insert(tenants).values(data).returning();
  if (!row) throw new Error('tenant insert returned no row');
  return row;
}

const updateTenantSchema = z
  .object({
    name: z.string().min(1),
    plan: z.string().nullable(),
    status: z.enum(['onboarding', 'active', 'paused', 'churned']),
    monthlyFeeMinor: z.number().int().nullable(),
    feeCurrency: z.string().length(3),
    partnerRateUntil: z
      .string()
      .regex(/^\d{4}-\d{2}-\d{2}$/)
      .nullable(),
    notes: z.string().nullable(),
  })
  .partial();

export type UpdateTenantInput = z.input<typeof updateTenantSchema>;

export async function updateTenant(tenantId: string, patch: UpdateTenantInput): Promise<Tenant> {
  const data = updateTenantSchema.parse(patch);
  if (Object.keys(data).length === 0) throw new Error('updateTenant: empty patch');
  const [row] = await adminDb().update(tenants).set(data).where(eq(tenants.id, tenantId)).returning();
  if (!row) throw new Error(`updateTenant: no tenant ${tenantId}`);
  return row;
}

export async function listTenants(): Promise<Tenant[]> {
  return adminDb().select().from(tenants).orderBy(asc(tenants.createdAt));
}

export async function getTenant(tenantId: string): Promise<Tenant | null> {
  const [row] = await adminDb().select().from(tenants).where(eq(tenants.id, tenantId)).limit(1);
  return row ?? null;
}

export async function getTenantBySlug(slug: string): Promise<Tenant | null> {
  const [row] = await adminDb().select().from(tenants).where(eq(tenants.slug, slug)).limit(1);
  return row ?? null;
}

export async function listActiveTenants(): Promise<Tenant[]> {
  return adminDb()
    .select()
    .from(tenants)
    .where(eq(tenants.status, 'active'))
    .orderBy(asc(tenants.createdAt));
}
