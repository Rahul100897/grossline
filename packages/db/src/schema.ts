import { sql } from 'drizzle-orm';
import {
  bigint,
  boolean,
  date,
  integer,
  jsonb,
  numeric,
  pgEnum,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from 'drizzle-orm/pg-core';

export const tenantStatus = pgEnum('tenant_status', ['onboarding', 'active', 'paused', 'churned']);
export const storePlatform = pgEnum('store_platform', ['shopify']);
export const connectionProvider = pgEnum('connection_provider', ['shopify', 'google_ads', 'meta']);
// 'unknown' = never synced. Health only becomes 'healthy' on real evidence
// (a successful sync); it must never be more optimistic than that.
export const connectionHealth = pgEnum('connection_health', [
  'healthy',
  'degraded',
  'broken',
  'unknown',
]);
export const syncKind = pgEnum('sync_kind', ['backfill', 'incremental']);
export const invoiceStatus = pgEnum('invoice_status', ['draft', 'sent', 'paid', 'void']);
export const ticketType = pgEnum('ticket_type', ['bug', 'question', 'feedback', 'feature']);
export const ticketStatus = pgEnum('ticket_status', ['open', 'in_progress', 'closed']);
export const ticketPriority = pgEnum('ticket_priority', ['low', 'normal', 'high']);
export const ticketSource = pgEnum('ticket_source', ['marketing', 'in_app']);
export const ticketAuthor = pgEnum('ticket_author', ['admin', 'submitter']);
export const syncStatus = pgEnum('sync_status', ['running', 'success', 'failed']);

export const tenants = pgTable('tenants', {
  id: uuid('id').primaryKey().defaultRandom(),
  name: text('name').notNull(),
  slug: text('slug').notNull().unique(),
  status: tenantStatus('status').notNull().default('onboarding'),
  plan: text('plan'),
  monthlyFeeMinor: integer('monthly_fee_minor'),
  feeCurrency: text('fee_currency').notNull().default('USD'),
  /** Design-partner rate expiry, if any (billing surfaces upcoming ones). */
  partnerRateUntil: date('partner_rate_until', { mode: 'string' }),
  /** Free-text analyst notes about the merchant (detail page Notes tab). */
  notes: text('notes'),
  reportingCurrency: text('reporting_currency').notNull(),
  reportingTimezone: text('reporting_timezone').notNull(),
  isDemo: boolean('is_demo').notNull().default(false),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
});

export const stores = pgTable(
  'stores',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    tenantId: uuid('tenant_id')
      .notNull()
      .references(() => tenants.id),
    platform: storePlatform('platform').notNull().default('shopify'),
    shopDomain: text('shop_domain').notNull(),
    storeCurrency: text('store_currency').notNull(),
    storeTimezone: text('store_timezone').notNull(),
    status: text('status').notNull().default('active'),
  },
  (t) => [uniqueIndex('stores_tenant_shop_domain_idx').on(t.tenantId, t.shopDomain)],
);

export const credentials = pgTable('credentials', {
  id: uuid('id').primaryKey().defaultRandom(),
  tenantId: uuid('tenant_id')
    .notNull()
    .references(() => tenants.id),
  provider: connectionProvider('provider').notNull(),
  ciphertext: text('ciphertext').notNull(),
  iv: text('iv').notNull(),
  keyVersion: integer('key_version').notNull(),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  rotatedAt: timestamp('rotated_at', { withTimezone: true }),
});

export const connections = pgTable('connections', {
  id: uuid('id').primaryKey().defaultRandom(),
  tenantId: uuid('tenant_id')
    .notNull()
    .references(() => tenants.id),
  storeId: uuid('store_id').references(() => stores.id),
  provider: connectionProvider('provider').notNull(),
  externalAccountId: text('external_account_id').notNull(),
  health: connectionHealth('health').notNull().default('unknown'),
  lastSuccessAt: timestamp('last_success_at', { withTimezone: true }),
  lastError: text('last_error'),
  credentialRef: uuid('credential_ref').references(() => credentials.id),
  // Recorded at connect time; reporting timezone is applied at query time only.
  accountTimezone: text('account_timezone'),
  accountCurrency: text('account_currency'),
  // Provider-specific configuration (e.g. Meta attribution_spec, Google MCC id).
  settings: jsonb('settings'),
  // Null while a backfill has not finished — downstream must treat the history
  // as partial until this is set.
  backfillCompletedAt: timestamp('backfill_completed_at', { withTimezone: true }),
});

// Resumable sync state: one row per (connection, stream). The cursor advances
// only after a chunk of work has committed, so an interrupted sync resumes
// instead of restarting.
export const syncCursors = pgTable(
  'sync_cursors',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    tenantId: uuid('tenant_id')
      .notNull()
      .references(() => tenants.id),
    connectionId: uuid('connection_id')
      .notNull()
      .references(() => connections.id),
    stream: text('stream').notNull(),
    cursor: jsonb('cursor').notNull(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [uniqueIndex('sync_cursors_conn_stream_idx').on(t.tenantId, t.connectionId, t.stream)],
);

export const syncRuns = pgTable('sync_runs', {
  id: uuid('id').primaryKey().defaultRandom(),
  tenantId: uuid('tenant_id')
    .notNull()
    .references(() => tenants.id),
  connectionId: uuid('connection_id').references(() => connections.id),
  kind: syncKind('kind').notNull(),
  windowStart: timestamp('window_start', { withTimezone: true }),
  windowEnd: timestamp('window_end', { withTimezone: true }),
  status: syncStatus('status').notNull().default('running'),
  rowsWritten: integer('rows_written').notNull().default(0),
  durationMs: integer('duration_ms'),
  error: text('error'),
  startedAt: timestamp('started_at', { withTimezone: true }).notNull().defaultNow(),
  finishedAt: timestamp('finished_at', { withTimezone: true }),
});

// ---- raw platform data ----
// Immutable landing zone: payloads exactly as the platform sent them, upserted
// on the platform's own ID (idempotent re-syncs), never edited with derived
// values. Metrics are computed elsewhere and can always be rebuilt from here.

export const rawShopifyOrders = pgTable(
  'raw_shopify_orders',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    tenantId: uuid('tenant_id')
      .notNull()
      .references(() => tenants.id),
    storeId: uuid('store_id')
      .notNull()
      .references(() => stores.id),
    /** Shopify gid, e.g. gid://shopify/Order/123 */
    orderId: text('order_id').notNull(),
    payload: jsonb('payload').notNull(),
    orderCreatedAt: timestamp('order_created_at', { withTimezone: true }).notNull(),
    orderUpdatedAt: timestamp('order_updated_at', { withTimezone: true }).notNull(),
    syncedAt: timestamp('synced_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [uniqueIndex('raw_shopify_orders_uniq').on(t.tenantId, t.storeId, t.orderId)],
);

export const rawShopifyCustomers = pgTable(
  'raw_shopify_customers',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    tenantId: uuid('tenant_id')
      .notNull()
      .references(() => tenants.id),
    storeId: uuid('store_id')
      .notNull()
      .references(() => stores.id),
    customerId: text('customer_id').notNull(),
    payload: jsonb('payload').notNull(),
    customerUpdatedAt: timestamp('customer_updated_at', { withTimezone: true }),
    syncedAt: timestamp('synced_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [uniqueIndex('raw_shopify_customers_uniq').on(t.tenantId, t.storeId, t.customerId)],
);

export const rawShopifyProducts = pgTable(
  'raw_shopify_products',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    tenantId: uuid('tenant_id')
      .notNull()
      .references(() => tenants.id),
    storeId: uuid('store_id')
      .notNull()
      .references(() => stores.id),
    productId: text('product_id').notNull(),
    payload: jsonb('payload').notNull(),
    productUpdatedAt: timestamp('product_updated_at', { withTimezone: true }),
    syncedAt: timestamp('synced_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [uniqueIndex('raw_shopify_products_uniq').on(t.tenantId, t.storeId, t.productId)],
);

export const rawMetaInsights = pgTable(
  'raw_meta_insights',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    tenantId: uuid('tenant_id')
      .notNull()
      .references(() => tenants.id),
    connectionId: uuid('connection_id')
      .notNull()
      .references(() => connections.id),
    adAccountId: text('ad_account_id').notNull(),
    /** 'account' or 'campaign' */
    level: text('level').notNull(),
    /** Empty string for account-level rows (keeps one plain unique index). */
    campaignId: text('campaign_id').notNull().default(''),
    /** Insights date_start, a date string in the ad account's own timezone. */
    date: date('date', { mode: 'string' }).notNull(),
    payload: jsonb('payload').notNull(),
    syncedAt: timestamp('synced_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    uniqueIndex('raw_meta_insights_uniq').on(
      t.tenantId,
      t.connectionId,
      t.level,
      t.campaignId,
      t.date,
    ),
  ],
);

export const rawGoogleAdsInsights = pgTable(
  'raw_google_ads_insights',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    tenantId: uuid('tenant_id')
      .notNull()
      .references(() => tenants.id),
    connectionId: uuid('connection_id')
      .notNull()
      .references(() => connections.id),
    customerId: text('customer_id').notNull(),
    campaignId: text('campaign_id').notNull(),
    /** segments.date — a date string in the ad account's own timezone. */
    date: date('date', { mode: 'string' }).notNull(),
    payload: jsonb('payload').notNull(),
    syncedAt: timestamp('synced_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    uniqueIndex('raw_google_ads_insights_uniq').on(
      t.tenantId,
      t.connectionId,
      t.campaignId,
      t.date,
    ),
  ],
);

// ---- merchant-supplied inputs (Phase 2) ----

export const productCostSource = pgEnum('product_cost_source', ['shopify', 'upload']);

// Unit costs with effective-from dates: a later upload NEVER changes a
// historical month's margin — resolution picks the latest row whose
// effective_from is on or before the order date. Missing cost stays missing.
export const productCosts = pgTable(
  'product_costs',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    tenantId: uuid('tenant_id')
      .notNull()
      .references(() => tenants.id),
    /** '' when the row is keyed by variant only. One of sku/variantId is set (CHECK). */
    sku: text('sku').notNull().default(''),
    /** Shopify ProductVariant gid, '' when keyed by sku only. */
    variantId: text('variant_id').notNull().default(''),
    unitCostMinor: integer('unit_cost_minor').notNull(),
    currency: text('currency').notNull(),
    effectiveFrom: date('effective_from', { mode: 'string' }).notNull(),
    source: productCostSource('source').notNull(),
    uploadedAt: timestamp('uploaded_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    uniqueIndex('product_costs_uniq').on(t.tenantId, t.sku, t.variantId, t.effectiveFrom),
  ],
);

// Merchant-supplied cost inputs as whole-row snapshots with effective-from
// dates: resolution picks the latest row on or before the date in question,
// so a later change never touches a historical month (same rule as
// product_costs). Every field nullable — merchants supply what they know,
// and missing is missing.
export const tenantCostInputs = pgTable(
  'tenant_cost_inputs',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    tenantId: uuid('tenant_id')
      .notNull()
      .references(() => tenants.id),
    effectiveFrom: date('effective_from', { mode: 'string' }).notNull(),
    currency: text('currency').notNull(),
    /** Basis points: 290 = 2.90% */
    paymentFeeBp: integer('payment_fee_bp'),
    paymentFeeFixedMinor: integer('payment_fee_fixed_minor'),
    shippingCostPerOrderMinor: integer('shipping_cost_per_order_minor'),
    fulfilmentCostPerOrderMinor: integer('fulfilment_cost_per_order_minor'),
    packagingCostPerOrderMinor: integer('packaging_cost_per_order_minor'),
    monthlyRevenueTargetMinor: bigint('monthly_revenue_target_minor', { mode: 'number' }),
    monthlySpendTargetMinor: bigint('monthly_spend_target_minor', { mode: 'number' }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [uniqueIndex('tenant_cost_inputs_uniq').on(t.tenantId, t.effectiveFrom)],
);

// ---- metric layer (Phase 2) ----
// Computed FROM raw_*, recomputable at any time; raw is never touched.

export const metricRunStatus = pgEnum('metric_run_status', ['running', 'success', 'failed']);

export const metricRuns = pgTable('metric_runs', {
  id: uuid('id').primaryKey().defaultRandom(),
  tenantId: uuid('tenant_id')
    .notNull()
    .references(() => tenants.id),
  periodStart: date('period_start', { mode: 'string' }).notNull(),
  periodEnd: date('period_end', { mode: 'string' }).notNull(),
  status: metricRunStatus('status').notNull().default('running'),
  error: text('error'),
  metricsWritten: integer('metrics_written').notNull().default(0),
  /** Latest raw synced_at seen by this run — what the numbers were computed from. */
  rawWatermark: timestamp('raw_watermark', { withTimezone: true }),
  startedAt: timestamp('started_at', { withTimezone: true }).notNull().defaultNow(),
  finishedAt: timestamp('finished_at', { withTimezone: true }),
});

// One row per (metric, grain, period, scope). Money values are integer minor
// units in `currency`; counts are integers; rates are decimals. `meta` carries
// completeness/provisional flags and FX traceability where applicable.
export const metricValues = pgTable(
  'metric_values',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    tenantId: uuid('tenant_id')
      .notNull()
      .references(() => tenants.id),
    metric: text('metric').notNull(),
    grain: text('grain').notNull(), // 'day' | 'month'
    /** Day: the reporting-timezone date label. Month: its first day. */
    period: date('period', { mode: 'string' }).notNull(),
    /** '' for tenant-level; e.g. 'platform:meta', 'campaign:google:123'. */
    scope: text('scope').notNull().default(''),
    value: numeric('value', { precision: 24, scale: 8 }).notNull(),
    currency: text('currency'),
    meta: jsonb('meta'),
    computedAt: timestamp('computed_at', { withTimezone: true }).notNull().defaultNow(),
    runId: uuid('run_id').references(() => metricRuns.id),
  },
  (t) => [
    uniqueIndex('metric_values_uniq').on(t.tenantId, t.metric, t.grain, t.period, t.scope),
  ],
);

// Global reference data (no tenant_id, like admin_users): daily ECB FX rates,
// base EUR. Not tenant data — one rate serves every tenant, and every
// converted amount records which rate row it used (rate + rate_date).
export const fxRates = pgTable(
  'fx_rates',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    base: text('base').notNull().default('EUR'),
    quote: text('quote').notNull(),
    rate: numeric('rate', { precision: 20, scale: 10 }).notNull(),
    rateDate: date('rate_date', { mode: 'string' }).notNull(),
    source: text('source').notNull().default('frankfurter/ecb'),
    fetchedAt: timestamp('fetched_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [uniqueIndex('fx_rates_uniq').on(t.base, t.quote, t.rateDate)],
);

// The one table without tenant_id: the analyst's own login, not tenant data.
export const adminUsers = pgTable('admin_users', {
  id: uuid('id').primaryKey().defaultRandom(),
  email: text('email').notNull().unique(),
  passwordHash: text('password_hash').notNull(),
  totpSecret: text('totp_secret').notNull(),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
});

// Issues are DERIVED, never authored (admin lib/issues.ts). This table is not
// the source of truth for what is open — it is the transition log that gives
// the Issues page a resolved history. Reconciled against the derived set:
// currently-open issues keep an unresolved row (last_seen_at bumped); a row
// whose issue is no longer derived gets resolved_at set. One unresolved row
// per (tenant_id, issue_key); a recurrence after resolution opens a new row.
export const issueLog = pgTable(
  'issue_log',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    tenantId: uuid('tenant_id')
      .notNull()
      .references(() => tenants.id),
    /** The derived issue's stable id (e.g. 'conn-broken-<connId>'). */
    issueKey: text('issue_key').notNull(),
    severity: text('severity').notNull(), // 'blocking' | 'attention'
    type: text('type').notNull(),
    summary: text('summary').notNull(),
    action: text('action').notNull(),
    openedAt: timestamp('opened_at', { withTimezone: true }).notNull().defaultNow(),
    lastSeenAt: timestamp('last_seen_at', { withTimezone: true }).notNull().defaultNow(),
    resolvedAt: timestamp('resolved_at', { withTimezone: true }),
  },
  (t) => [
    // At most one unresolved row per issue; partial so resolved history piles up.
    uniqueIndex('issue_log_open_uniq')
      .on(t.tenantId, t.issueKey)
      .where(sql`${t.resolvedAt} is null`),
  ],
);

// Invoices we raise (task 3.6). Tenant-scoped; the total is the sum of lines,
// never a denormalised column that could drift. Money is integer minor units.
export const invoices = pgTable(
  'invoices',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    tenantId: uuid('tenant_id')
      .notNull()
      .references(() => tenants.id),
    /** Human invoice number, globally unique across tenants (one issuer). */
    number: text('number').notNull().unique(),
    status: invoiceStatus('status').notNull().default('draft'),
    currency: text('currency').notNull(),
    issuedOn: date('issued_on', { mode: 'string' }).notNull(),
    dueOn: date('due_on', { mode: 'string' }).notNull(),
    notes: text('notes'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [uniqueIndex('invoices_number_uniq').on(t.number)],
);

// Period lines on an invoice (e.g. the three months of a billed quarter).
export const invoiceLines = pgTable('invoice_lines', {
  id: uuid('id').primaryKey().defaultRandom(),
  tenantId: uuid('tenant_id')
    .notNull()
    .references(() => tenants.id),
  invoiceId: uuid('invoice_id')
    .notNull()
    .references(() => invoices.id),
  description: text('description').notNull(),
  periodStart: date('period_start', { mode: 'string' }).notNull(),
  periodEnd: date('period_end', { mode: 'string' }).notNull(),
  amountMinor: integer('amount_minor').notNull(),
  currency: text('currency').notNull(),
});

// Payments received against an invoice. Xflow settles USD invoices to INR;
// the fee and the net INR actually received are recorded (manual — no gateway),
// so the quarter's collected total reconciles against the bank, not an estimate.
export const payments = pgTable('payments', {
  id: uuid('id').primaryKey().defaultRandom(),
  tenantId: uuid('tenant_id')
    .notNull()
    .references(() => tenants.id),
  invoiceId: uuid('invoice_id')
    .notNull()
    .references(() => invoices.id),
  /** Gross amount in the invoice currency. */
  grossMinor: integer('gross_minor').notNull(),
  grossCurrency: text('gross_currency').notNull(),
  /** Xflow fee, in the invoice currency. */
  xflowFeeMinor: integer('xflow_fee_minor'),
  /** Net actually settled to the INR account (minor units, paise). */
  netInrMinor: integer('net_inr_minor'),
  /** Effective USD→INR rate applied by Xflow on this settlement. */
  fxRate: numeric('fx_rate', { precision: 20, scale: 10 }),
  receivedOn: date('received_on', { mode: 'string' }).notNull(),
  reference: text('reference'),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
});

// The analyst's own business/invoicing details for the invoice PDF. One row,
// no tenant_id (like admin_users) — this is the issuer, not tenant data. Task
// 3.8 edits it; 3.6 reads it for the PDF.
export const businessProfile = pgTable('business_profile', {
  id: uuid('id').primaryKey().defaultRandom(),
  legalName: text('legal_name').notNull(),
  addressLines: text('address_lines'),
  gstin: text('gstin'),
  /** Export LUT (Letter of Undertaking) number for zero-rated service export. */
  lutNumber: text('lut_number'),
  invoiceEmail: text('invoice_email'),
  /** Bank / remittance details block, free text. */
  bankDetails: text('bank_details'),
  footer: text('footer'),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
});

// Support tickets (task 3.7). Two intake points — the marketing site form and
// the in-app widget — land here. tenant_id is nullable (a marketing-site
// visitor has no tenant), so tickets live on the admin connection like
// audit_log, not under tenant RLS. The reply thread is ticket_messages.
export const tickets = pgTable('tickets', {
  id: uuid('id').primaryKey().defaultRandom(),
  type: ticketType('type').notNull(),
  source: ticketSource('source').notNull(),
  status: ticketStatus('status').notNull().default('open'),
  priority: ticketPriority('priority').notNull().default('normal'),
  subject: text('subject').notNull(),
  body: text('body').notNull(),
  submitterName: text('submitter_name'),
  submitterEmail: text('submitter_email'),
  /** Optional link to a tenant (in-app submissions can carry one). */
  tenantId: uuid('tenant_id').references(() => tenants.id),
  /** Internal analyst notes, never shown to the submitter. */
  notes: text('notes'),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
});

export const ticketMessages = pgTable('ticket_messages', {
  id: uuid('id').primaryKey().defaultRandom(),
  ticketId: uuid('ticket_id')
    .notNull()
    .references(() => tickets.id),
  author: ticketAuthor('author').notNull(),
  body: text('body').notNull(),
  /** Whether this reply was emailed to the submitter (admin replies). */
  emailed: boolean('emailed').notNull().default(false),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
});

export const auditLog = pgTable('audit_log', {
  id: uuid('id').primaryKey().defaultRandom(),
  actor: text('actor').notNull(),
  // Nullable: admin-level events (login, tenant creation) have no tenant yet.
  tenantId: uuid('tenant_id').references(() => tenants.id),
  action: text('action').notNull(),
  subject: text('subject'),
  metadata: jsonb('metadata'),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
});
