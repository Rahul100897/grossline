// Billing data access (docs/phase-3.md task 3.6). Tenant-scoped invoice,
// line and payment reads/writes go through withTenant; the invoice number is
// allocated on the admin connection (one issuer, globally sequential). The
// business profile is the issuer's own single row, on the admin connection.
import { and, asc, desc, eq, sql } from 'drizzle-orm';
import { z } from 'zod';
import { adminDb } from './client';
import { businessProfile, invoiceLines, invoices, payments, tenants } from './schema';
import { withTenant } from './tenant-scope';

export type Invoice = typeof invoices.$inferSelect;
export type InvoiceLine = typeof invoiceLines.$inferSelect;
export type Payment = typeof payments.$inferSelect;
export type BusinessProfile = typeof businessProfile.$inferSelect;

export type InvoiceWithLines = Invoice & {
  lines: InvoiceLine[];
  totalMinor: number;
};

const lineInput = z.object({
  description: z.string().min(1),
  periodStart: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  periodEnd: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  amountMinor: z.number().int(),
});

const createInvoiceSchema = z.object({
  tenantId: z.string().uuid(),
  currency: z.string().length(3),
  issuedOn: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  dueOn: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  notes: z.string().nullable().optional(),
  lines: z.array(lineInput).min(1),
});

export type CreateInvoiceInput = z.input<typeof createInvoiceSchema>;

/** Allocate GL-YYYY-NNNN from the count of invoices issued that calendar year. */
async function allocateInvoiceNumber(issuedOn: string): Promise<string> {
  const year = issuedOn.slice(0, 4);
  const rows = await adminDb()
    .select({ count: sql<number>`count(*)::int` })
    .from(invoices)
    .where(sql`extract(year from ${invoices.issuedOn}) = ${Number(year)}`);
  const seq = (rows[0]?.count ?? 0) + 1;
  return `GL-${year}-${String(seq).padStart(4, '0')}`;
}

export async function createInvoice(input: CreateInvoiceInput): Promise<InvoiceWithLines> {
  const data = createInvoiceSchema.parse(input);
  const number = await allocateInvoiceNumber(data.issuedOn);
  return withTenant(data.tenantId, async (tx) => {
    const [invoice] = await tx
      .insert(invoices)
      .values({
        tenantId: data.tenantId,
        number,
        currency: data.currency,
        issuedOn: data.issuedOn,
        dueOn: data.dueOn,
        notes: data.notes ?? null,
      })
      .returning();
    if (!invoice) throw new Error('invoice insert returned no row');
    const lines = await tx
      .insert(invoiceLines)
      .values(
        data.lines.map((l) => ({
          tenantId: data.tenantId,
          invoiceId: invoice.id,
          description: l.description,
          periodStart: l.periodStart,
          periodEnd: l.periodEnd,
          amountMinor: l.amountMinor,
          currency: data.currency,
        })),
      )
      .returning();
    return { ...invoice, lines, totalMinor: lines.reduce((s, l) => s + l.amountMinor, 0) };
  });
}

export async function getInvoiceWithLines(
  tenantId: string,
  invoiceId: string,
): Promise<InvoiceWithLines | null> {
  return withTenant(tenantId, async (tx) => {
    const [invoice] = await tx.select().from(invoices).where(eq(invoices.id, invoiceId)).limit(1);
    if (!invoice) return null;
    const lines = await tx
      .select()
      .from(invoiceLines)
      .where(eq(invoiceLines.invoiceId, invoiceId))
      .orderBy(asc(invoiceLines.periodStart));
    return { ...invoice, lines, totalMinor: lines.reduce((s, l) => s + l.amountMinor, 0) };
  });
}

export async function updateInvoiceStatus(
  tenantId: string,
  invoiceId: string,
  status: 'draft' | 'sent' | 'paid' | 'void',
): Promise<void> {
  await withTenant(tenantId, (tx) =>
    tx.update(invoices).set({ status }).where(eq(invoices.id, invoiceId)),
  );
}

export type InvoiceListRow = Invoice & { totalMinor: number; tenantName: string };

/** Every invoice across every tenant, newest first — for the billing overview. */
export async function listAllInvoices(): Promise<InvoiceListRow[]> {
  const tenantRows = await adminDb()
    .select({ id: tenants.id, name: tenants.name })
    .from(tenants)
    .orderBy(asc(tenants.name));
  const rows: InvoiceListRow[] = [];
  for (const tenant of tenantRows) {
    const list = await withTenant(tenant.id, (tx) =>
      tx
        .select({
          invoice: invoices,
          totalMinor: sql<number>`coalesce(sum(${invoiceLines.amountMinor}), 0)::int`,
        })
        .from(invoices)
        .leftJoin(invoiceLines, eq(invoiceLines.invoiceId, invoices.id))
        .groupBy(invoices.id)
        .orderBy(desc(invoices.issuedOn)),
    );
    for (const r of list) rows.push({ ...r.invoice, totalMinor: r.totalMinor, tenantName: tenant.name });
  }
  return rows.sort((a, b) => (a.issuedOn < b.issuedOn ? 1 : a.issuedOn > b.issuedOn ? -1 : 0));
}

export type PaymentListRow = Payment & { tenantName: string; invoiceNumber: string };

/** Every payment across every tenant, newest first. */
export async function listAllPayments(): Promise<PaymentListRow[]> {
  const tenantRows = await adminDb()
    .select({ id: tenants.id, name: tenants.name })
    .from(tenants)
    .orderBy(asc(tenants.name));
  const rows: PaymentListRow[] = [];
  for (const tenant of tenantRows) {
    const list = await withTenant(tenant.id, (tx) =>
      tx
        .select({ payment: payments, number: invoices.number })
        .from(payments)
        .innerJoin(invoices, eq(invoices.id, payments.invoiceId))
        .orderBy(desc(payments.receivedOn)),
    );
    for (const r of list)
      rows.push({ ...r.payment, tenantName: tenant.name, invoiceNumber: r.number });
  }
  return rows.sort((a, b) => (a.receivedOn < b.receivedOn ? 1 : a.receivedOn > b.receivedOn ? -1 : 0));
}

export async function listPaymentsForInvoice(
  tenantId: string,
  invoiceId: string,
): Promise<Payment[]> {
  return withTenant(tenantId, (tx) =>
    tx
      .select()
      .from(payments)
      .where(eq(payments.invoiceId, invoiceId))
      .orderBy(desc(payments.receivedOn)),
  );
}

const recordPaymentSchema = z.object({
  tenantId: z.string().uuid(),
  invoiceId: z.string().uuid(),
  grossMinor: z.number().int(),
  grossCurrency: z.string().length(3),
  xflowFeeMinor: z.number().int().nullable(),
  netInrMinor: z.number().int().nullable(),
  fxRate: z.string().nullable(),
  receivedOn: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  reference: z.string().nullable(),
  markPaid: z.boolean(),
});

export type RecordPaymentInput = z.input<typeof recordPaymentSchema>;

export async function recordPayment(input: RecordPaymentInput): Promise<void> {
  const data = recordPaymentSchema.parse(input);
  await withTenant(data.tenantId, async (tx) => {
    await tx.insert(payments).values({
      tenantId: data.tenantId,
      invoiceId: data.invoiceId,
      grossMinor: data.grossMinor,
      grossCurrency: data.grossCurrency,
      xflowFeeMinor: data.xflowFeeMinor,
      netInrMinor: data.netInrMinor,
      fxRate: data.fxRate,
      receivedOn: data.receivedOn,
      reference: data.reference,
    });
    if (data.markPaid) {
      await tx.update(invoices).set({ status: 'paid' }).where(eq(invoices.id, data.invoiceId));
    }
  });
}

export async function getBusinessProfile(): Promise<BusinessProfile | null> {
  const [row] = await adminDb().select().from(businessProfile).limit(1);
  return row ?? null;
}

const businessProfileSchema = z.object({
  legalName: z.string().min(1),
  addressLines: z.string().nullable(),
  gstin: z.string().nullable(),
  lutNumber: z.string().nullable(),
  invoiceEmail: z.string().nullable(),
  bankDetails: z.string().nullable(),
  footer: z.string().nullable(),
});

export type BusinessProfileInput = z.input<typeof businessProfileSchema>;

export async function upsertBusinessProfile(
  input: BusinessProfileInput,
): Promise<BusinessProfile> {
  const data = businessProfileSchema.parse(input);
  const existing = await getBusinessProfile();
  if (existing) {
    const [row] = await adminDb()
      .update(businessProfile)
      .set({ ...data, updatedAt: new Date() })
      .where(eq(businessProfile.id, existing.id))
      .returning();
    return row!;
  }
  const [row] = await adminDb().insert(businessProfile).values(data).returning();
  return row!;
}

/** Billed (non-void invoice lines) and collected (gross) for one tenant. */
export async function tenantBillingTotals(
  tenantId: string,
): Promise<{ billedMinor: number; collectedGrossMinor: number; currency: string | null }> {
  return withTenant(tenantId, async (tx) => {
    const [billed] = await tx
      .select({
        total: sql<number>`coalesce(sum(${invoiceLines.amountMinor}), 0)::int`,
        currency: sql<string | null>`max(${invoices.currency})`,
      })
      .from(invoices)
      .leftJoin(invoiceLines, eq(invoiceLines.invoiceId, invoices.id))
      .where(sql`${invoices.status} <> 'void'`);
    const [collected] = await tx
      .select({ total: sql<number>`coalesce(sum(${payments.grossMinor}), 0)::int` })
      .from(payments);
    return {
      billedMinor: billed?.total ?? 0,
      collectedGrossMinor: collected?.total ?? 0,
      currency: billed?.currency ?? null,
    };
  });
}

/** Collected (net where recorded, else gross) grouped by plan, this period. */
export type PlanRevenue = { plan: string; invoiceCount: number; billedMinor: number; currency: string };

/** Sum of issued (non-void) invoice line amounts grouped by tenant plan. */
export async function revenueByPlan(): Promise<PlanRevenue[]> {
  const tenantRows = await adminDb()
    .select({ id: tenants.id, plan: tenants.plan })
    .from(tenants);
  const byPlan = new Map<string, { count: number; minor: number; currency: string }>();
  for (const tenant of tenantRows) {
    const plan = tenant.plan ?? 'unplanned';
    const list = await withTenant(tenant.id, (tx) =>
      tx
        .select({
          currency: invoices.currency,
          total: sql<number>`coalesce(sum(${invoiceLines.amountMinor}), 0)::int`,
        })
        .from(invoices)
        .leftJoin(invoiceLines, eq(invoiceLines.invoiceId, invoices.id))
        .where(and(eq(invoices.tenantId, tenant.id), sql`${invoices.status} <> 'void'`))
        .groupBy(invoices.currency),
    );
    for (const r of list) {
      const cur = byPlan.get(plan) ?? { count: 0, minor: 0, currency: r.currency };
      cur.minor += r.total;
      cur.count += 1;
      byPlan.set(plan, cur);
    }
  }
  return [...byPlan.entries()]
    .map(([plan, v]) => ({ plan, invoiceCount: v.count, billedMinor: v.minor, currency: v.currency }))
    .sort((a, b) => b.billedMinor - a.billedMinor);
}
