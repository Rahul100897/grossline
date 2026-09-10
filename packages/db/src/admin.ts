// Explicit cross-tenant operations for the admin console and operational
// scripts. These run on the admin connection, which RLS does not constrain —
// which is exactly why each one is a named function with a narrow shape
// instead of an exported database handle.
import { asc, eq, inArray } from 'drizzle-orm';
import { z } from 'zod';
import { adminDb } from './client';
import {
  connections,
  credentials,
  findings,
  invoiceLines,
  invoices,
  issueLog,
  metricRuns,
  metricValues,
  payments,
  productCosts,
  rawGoogleAdsInsights,
  rawMetaInsights,
  rawShopifyCustomers,
  rawShopifyOrders,
  rawShopifyProducts,
  reconciliationRuns,
  reports,
  stores,
  syncCursors,
  syncRuns,
  tenantCalibration,
  tenantCostInputs,
  tenants,
  ticketMessages,
  tickets,
} from './schema';

const createTenantSchema = z.object({
  name: z.string().min(1),
  slug: z
    .string()
    .min(1)
    .regex(/^[a-z0-9-]+$/, 'slug must be lowercase kebab-case'),
  reportingCurrency: z.string().length(3),
  reportingTimezone: z.string().min(1),
  plan: z.string().optional(),
  status: z.enum(['onboarding', 'trial', 'active', 'paused', 'churned']).optional(),
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
    status: z.enum(['onboarding', 'trial', 'active', 'paused', 'churned']),
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

/**
 * Offboard a tenant (task 5.B7): revoke connections and delete all of the
 * tenant's data on a single action, then mark the tenant churned (the row is
 * kept for the record; MRR already excludes non-active tenants). Runs on the
 * admin connection and deletes children before parents to respect foreign keys.
 * Audit log is deliberately preserved — it records that this happened.
 */
export async function offboardTenant(tenantId: string): Promise<void> {
  const db = adminDb();
  // ticket_messages have no tenant_id — delete via their tenant-linked tickets.
  const tenantTickets = await db
    .select({ id: tickets.id })
    .from(tickets)
    .where(eq(tickets.tenantId, tenantId));
  const ticketIds = tenantTickets.map((t) => t.id);
  if (ticketIds.length > 0) {
    await db.delete(ticketMessages).where(inArray(ticketMessages.ticketId, ticketIds));
    await db.delete(tickets).where(eq(tickets.tenantId, tenantId));
  }

  // Metric values reference metric runs.
  await db.delete(metricValues).where(eq(metricValues.tenantId, tenantId));
  await db.delete(metricRuns).where(eq(metricRuns.tenantId, tenantId));

  // Rows referencing connections / stores.
  await db.delete(syncRuns).where(eq(syncRuns.tenantId, tenantId));
  await db.delete(syncCursors).where(eq(syncCursors.tenantId, tenantId));
  await db.delete(rawMetaInsights).where(eq(rawMetaInsights.tenantId, tenantId));
  await db.delete(rawGoogleAdsInsights).where(eq(rawGoogleAdsInsights.tenantId, tenantId));
  await db.delete(rawShopifyOrders).where(eq(rawShopifyOrders.tenantId, tenantId));
  await db.delete(rawShopifyCustomers).where(eq(rawShopifyCustomers.tenantId, tenantId));
  await db.delete(rawShopifyProducts).where(eq(rawShopifyProducts.tenantId, tenantId));

  // Billing: lines and payments reference invoices.
  await db.delete(invoiceLines).where(eq(invoiceLines.tenantId, tenantId));
  await db.delete(payments).where(eq(payments.tenantId, tenantId));
  await db.delete(invoices).where(eq(invoices.tenantId, tenantId));

  // Derived / report / cost / findings state.
  await db.delete(findings).where(eq(findings.tenantId, tenantId));
  await db.delete(reports).where(eq(reports.tenantId, tenantId));
  await db.delete(reconciliationRuns).where(eq(reconciliationRuns.tenantId, tenantId));
  await db.delete(issueLog).where(eq(issueLog.tenantId, tenantId));
  await db.delete(productCosts).where(eq(productCosts.tenantId, tenantId));
  await db.delete(tenantCostInputs).where(eq(tenantCostInputs.tenantId, tenantId));
  await db.delete(tenantCalibration).where(eq(tenantCalibration.tenantId, tenantId));

  // Connections reference stores and credentials — delete them, then those.
  await db.delete(connections).where(eq(connections.tenantId, tenantId));
  await db.delete(stores).where(eq(stores.tenantId, tenantId));
  await db.delete(credentials).where(eq(credentials.tenantId, tenantId));

  // Keep the tenant row as a churned record; clear the fee so it never bills.
  await db
    .update(tenants)
    .set({ status: 'churned', monthlyFeeMinor: null, plan: null })
    .where(eq(tenants.id, tenantId));
}

export async function listActiveTenants(): Promise<Tenant[]> {
  return adminDb()
    .select()
    .from(tenants)
    .where(eq(tenants.status, 'active'))
    .orderBy(asc(tenants.createdAt));
}
