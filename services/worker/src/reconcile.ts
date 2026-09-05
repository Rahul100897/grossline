// Reconciliation harness (task 1.7): our totals from the raw tables beside
// the platform UI's own figures, with variance and — where a difference is
// structural — the reason, not just the number.
//
// These are reconciliation *reference totals* computed per docs/metrics.md
// definitions, not the Phase 2 metric layer.
import { and, eq, inArray, sql } from 'drizzle-orm';
import { z } from 'zod';
import { monthWindow } from '@grossline/core';
import { getTenant, getTenantBySlug, listConnections, schema, withTenant, type Tenant } from '@grossline/db';

// ---- expected-values file ----

const expectedMetricSchema = z.object({
  value: z.number(),
  /** Written explanation for a variance outside tolerance (makes it pass). */
  explanation: z.string().optional(),
});

export const expectedMonthSchema = z.object({
  shopifyNetSales: expectedMetricSchema.optional(),
  shopifyOrders: expectedMetricSchema.optional(),
  newCustomers: expectedMetricSchema.optional(),
  metaSpend: expectedMetricSchema.optional(),
  googleCost: expectedMetricSchema.optional(),
});

export const expectedFileSchema = z.object({
  tenant: z.string(),
  currency: z.string().default('USD'),
  months: z.record(z.string().regex(/^\d{4}-\d{2}$/), expectedMonthSchema),
});

export type ExpectedFile = z.infer<typeof expectedFileSchema>;

// ---- tolerances (fractions) ----
export const TOLERANCES: Record<MetricKey, number> = {
  shopifyOrders: 0, // order counts should match exactly
  newCustomers: 0,
  shopifyNetSales: 0.005, // 0.5%
  googleCost: 0.01, // task 1.4 exit criterion
  metaSpend: 0.02, // task 1.3 exit criterion
};

export type MetricKey =
  | 'shopifyNetSales'
  | 'shopifyOrders'
  | 'newCustomers'
  | 'metaSpend'
  | 'googleCost';

export type ReconciliationRow = {
  metric: MetricKey;
  /** Our figure. Money metrics are major units (e.g. dollars), counts are counts. */
  ours: number;
  expected: number | null;
  variance: number | null;
  variancePct: number | null;
  tolerancePct: number;
  status: 'within' | 'outside' | 'explained' | 'no-expected';
  note?: string;
};

export type ReconciliationReport = {
  tenant: string;
  month: string;
  currency: string;
  rows: ReconciliationRow[];
  structuralNotes: string[];
  ok: boolean;
};

// ---- our totals from raw ----

const cents = (amount: string | number): number => Math.round(Number(amount) * 100);

const orderPayloadSchema = z
  .object({
    cancelledAt: z.string().nullable(),
    totalDiscountsSet: z.object({ shopMoney: z.object({ amount: z.string() }) }),
    customer: z.object({ numberOfOrders: z.string() }).nullable().optional(),
    customerJourneySummary: z
      .object({ customerOrderIndex: z.number().nullable().optional() })
      .nullable()
      .optional(),
    lineItems: z
      .array(
        z.object({
          quantity: z.number(),
          originalUnitPriceSet: z.object({ shopMoney: z.object({ amount: z.string() }) }),
        }),
      )
      .optional(),
    refunds: z
      .array(
        z.object({
          refundLineItems: z
            .array(z.object({ subtotalSet: z.object({ shopMoney: z.object({ amount: z.string() }) }) }))
            .optional(),
        }),
      )
      .optional(),
  })
  .passthrough();

export type OurTotals = {
  shopifyNetSalesCents: number;
  shopifyOrders: number;
  newCustomers: number;
  metaSpendCents: number;
  googleCostCents: number;
};

export async function computeOurTotals(
  tenant: Tenant,
  year: number,
  month: number,
): Promise<OurTotals> {
  const window = monthWindow(tenant.reportingTimezone, year, month);

  // The order date is processedAt everywhere (docs/metrics.md, 2026-09-05) —
  // Shopify Analytics keys on it, and Analytics is what we reconcile against.
  const orderRows = await withTenant(tenant.id, (tx) =>
    tx
      .select({ payload: schema.rawShopifyOrders.payload })
      .from(schema.rawShopifyOrders)
      .where(
        and(
          sql`(${schema.rawShopifyOrders.payload}->>'processedAt')::timestamptz >= ${window.startUtc}`,
          sql`(${schema.rawShopifyOrders.payload}->>'processedAt')::timestamptz < ${window.endUtc}`,
        ),
      ),
  );

  let netSalesCents = 0;
  let orders = 0;
  let newCustomers = 0;
  for (const row of orderRows) {
    const order = orderPayloadSchema.parse(row.payload);
    if (order.cancelledAt !== null) continue; // excluded from all revenue metrics
    orders++;

    let grossCents = 0;
    for (const line of order.lineItems ?? []) {
      grossCents += cents(line.originalUnitPriceSet.shopMoney.amount) * line.quantity;
    }
    const discountCents = cents(order.totalDiscountsSet.shopMoney.amount);
    // Returns recognised on the ORIGINAL order date (docs/metrics.md): sum the
    // refund line items of orders created in this month, whenever refunded.
    // Shipping-only refunds have no refund line items and do not reduce net sales.
    let returnsCents = 0;
    for (const refund of order.refunds ?? []) {
      for (const rli of refund.refundLineItems ?? []) {
        returnsCents += cents(rli.subtotalSet.shopMoney.amount);
      }
    }
    netSalesCents += grossCents - discountCents - returnsCents;

    const orderIndex = order.customerJourneySummary?.customerOrderIndex;
    const isNew =
      orderIndex != null ? orderIndex === 1 : order.customer?.numberOfOrders === '1';
    if (isNew) newCustomers++;
  }

  const metaRows = await withTenant(tenant.id, (tx) =>
    tx
      .select({ payload: schema.rawMetaInsights.payload })
      .from(schema.rawMetaInsights)
      .where(
        and(
          eq(schema.rawMetaInsights.level, 'account'),
          inArray(schema.rawMetaInsights.date, window.dateStrings),
        ),
      ),
  );
  let metaSpendCents = 0;
  for (const row of metaRows) {
    const spend = (row.payload as { spend?: string }).spend;
    if (spend) metaSpendCents += cents(spend);
  }

  const googleRows = await withTenant(tenant.id, (tx) =>
    tx
      .select({ payload: schema.rawGoogleAdsInsights.payload })
      .from(schema.rawGoogleAdsInsights)
      .where(inArray(schema.rawGoogleAdsInsights.date, window.dateStrings)),
  );
  let googleCostMicros = 0;
  for (const row of googleRows) {
    const micros = (row.payload as { metrics?: { costMicros?: string } }).metrics?.costMicros;
    if (micros) googleCostMicros += Number(micros);
  }

  return {
    shopifyNetSalesCents: netSalesCents,
    shopifyOrders: orders,
    newCustomers,
    metaSpendCents,
    googleCostCents: Math.round(googleCostMicros / 10_000),
  };
}

// ---- structural notes ----

export async function structuralNotes(
  tenant: Tenant,
  year: number,
  month: number,
  now: Date = new Date(),
): Promise<string[]> {
  const notes: string[] = [];
  const window = monthWindow(tenant.reportingTimezone, year, month);
  const daysSinceMonthEnd = (now.getTime() - window.endUtc.getTime()) / 86_400_000;

  if (daysSinceMonthEnd < 28) {
    notes.push(
      'Meta restates the trailing 28 days — this month is still inside that window, so Meta spend may move until ' +
        new Date(window.endUtc.getTime() + 28 * 86_400_000).toISOString().slice(0, 10) +
        '.',
    );
  }
  if (daysSinceMonthEnd < 30) {
    notes.push(
      'Google conversions restate for up to ~30 days (cost itself is stable within a day or two).',
    );
  }

  const connections = await listConnections(tenant.id);
  const adTimezones = new Set(
    connections
      .filter((c) => c.provider !== 'shopify' && c.accountTimezone)
      .map((c) => c.accountTimezone as string),
  );
  for (const tz of adTimezones) {
    if (tz !== tenant.reportingTimezone) {
      notes.push(
        `Ad account timezone ${tz} differs from reporting timezone ${tenant.reportingTimezone}: platform days are bucketed by their own label, so up to one day of spend can sit across the month boundary versus the platform UI viewed in another timezone.`,
      );
    }
  }
  return notes;
}

// ---- the report ----

export async function reconcile(input: {
  tenantIdOrSlug: string;
  month: string; // YYYY-MM
  expected?: ExpectedFile | null;
  now?: Date;
}): Promise<ReconciliationReport> {
  const tenant =
    (await getTenantBySlug(input.tenantIdOrSlug)) ?? (await getTenant(input.tenantIdOrSlug));
  if (!tenant) throw new Error(`tenant not found: ${input.tenantIdOrSlug}`);
  const match = /^(\d{4})-(\d{2})$/.exec(input.month);
  if (!match) throw new Error('month must be YYYY-MM');
  const year = Number(match[1]);
  const month = Number(match[2]);

  const totals = await computeOurTotals(tenant, year, month);
  const expectedMonth = input.expected?.months[input.month] ?? {};

  const ours: Record<MetricKey, number> = {
    shopifyNetSales: totals.shopifyNetSalesCents / 100,
    shopifyOrders: totals.shopifyOrders,
    newCustomers: totals.newCustomers,
    metaSpend: totals.metaSpendCents / 100,
    googleCost: totals.googleCostCents / 100,
  };

  const rows: ReconciliationRow[] = (Object.keys(ours) as MetricKey[]).map((metric) => {
    const expected = expectedMonth[metric] ?? null;
    const tolerancePct = TOLERANCES[metric] * 100;
    if (!expected) {
      return {
        metric,
        ours: ours[metric],
        expected: null,
        variance: null,
        variancePct: null,
        tolerancePct,
        status: 'no-expected',
        note: 'no platform figure recorded yet',
      };
    }
    const variance = ours[metric] - expected.value;
    const variancePct = expected.value === 0 ? (ours[metric] === 0 ? 0 : Infinity) : Math.abs(variance / expected.value);
    const within = variancePct <= TOLERANCES[metric] + 1e-12;
    const status = within ? 'within' : expected.explanation ? 'explained' : 'outside';
    return {
      metric,
      ours: ours[metric],
      expected: expected.value,
      variance,
      variancePct: variancePct * 100,
      tolerancePct,
      status,
      note: !within ? expected.explanation : undefined,
    };
  });

  return {
    tenant: tenant.slug,
    month: input.month,
    currency: input.expected?.currency ?? tenant.reportingCurrency,
    rows,
    structuralNotes: await structuralNotes(tenant, year, month, input.now),
    ok: rows.every((r) => r.status !== 'outside'),
  };
}
