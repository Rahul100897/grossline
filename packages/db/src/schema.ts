import {
  boolean,
  integer,
  jsonb,
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
export const connectionHealth = pgEnum('connection_health', ['healthy', 'degraded', 'broken']);
export const syncKind = pgEnum('sync_kind', ['backfill', 'incremental']);
export const syncStatus = pgEnum('sync_status', ['running', 'success', 'failed']);

export const tenants = pgTable('tenants', {
  id: uuid('id').primaryKey().defaultRandom(),
  name: text('name').notNull(),
  slug: text('slug').notNull().unique(),
  status: tenantStatus('status').notNull().default('onboarding'),
  plan: text('plan'),
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
  health: connectionHealth('health').notNull().default('healthy'),
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

// The one table without tenant_id: the analyst's own login, not tenant data.
export const adminUsers = pgTable('admin_users', {
  id: uuid('id').primaryKey().defaultRandom(),
  email: text('email').notNull().unique(),
  passwordHash: text('password_hash').notNull(),
  totpSecret: text('totp_secret').notNull(),
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
