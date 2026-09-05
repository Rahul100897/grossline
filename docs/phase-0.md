# Phase 0 — Foundations

Goal: two tenants can coexist in the database with isolated data, encrypted credentials and a working job runner, with nothing merchant-specific hardcoded anywhere.

No connectors in this phase. No UI beyond a login. Resist the urge.

---

## Tasks

Each one is a PR. Do them in order. Run `pnpm verify` before opening each.

### 0.1 — Monorepo scaffold
pnpm workspaces with the layout in CLAUDE.md. Shared tsconfig, eslint and prettier in `packages/config`. Root scripts: `dev`, `verify`, `db:migrate`, `db:studio`. `docker-compose.yml` bringing up Postgres 16 and Redis 7. `.env.example` with names only.

**Done when** a fresh clone runs `pnpm install && docker compose up -d && pnpm verify` successfully.

### 0.2 — Core schema
Drizzle schema in `packages/db`:

- `tenants` — id, name, slug, status (`onboarding | active | paused | churned`), plan, reporting_currency, reporting_timezone, is_demo, created_at
- `stores` — id, tenant_id, platform (`shopify`), shop_domain, store_currency, store_timezone, status
- `connections` — id, tenant_id, store_id nullable, provider (`shopify | google_ads | meta`), external_account_id, health (`healthy | degraded | broken`), last_success_at, last_error, credential_ref
- `credentials` — id, tenant_id, ciphertext, iv, key_version, created_at, rotated_at
- `sync_runs` — id, tenant_id, connection_id, kind (`backfill | incremental`), window_start, window_end, status (`running | success | failed`), rows_written, duration_ms, error, started_at, finished_at
- `admin_users` — id, email, password_hash, totp_secret, created_at
- `audit_log` — id, actor, tenant_id, action, subject, metadata jsonb, created_at

Every table except `admin_users` has `tenant_id`. Postgres RLS enabled on all tenant tables.

**Done when** migrations apply cleanly, RLS policies exist, and a test proves a query without a tenant context returns zero rows.

### 0.3 — Tenant-scoped data access
Query helpers in `packages/db` that take a tenant context and set it on the connection. Direct database client access from anywhere outside `packages/db` fails lint.

**Done when** a test creates two tenants, writes rows for each, and proves tenant A's context cannot read tenant B's rows through any exported helper.

### 0.4 — Credential store
Envelope encryption. Data key per credential, wrapped by a master key from the environment. `putCredential(tenantId, provider, payload)` and `getCredential(ref)`. Key version stored so rotation is possible later. Nothing logs plaintext, ever.

**Done when** a round-trip test passes, the ciphertext column contains no readable substring of the payload, and a test asserts no logger call receives the plaintext.

### 0.5 — Job runner
BullMQ with one queue per tenant. Retry with exponential backoff, three attempts, then dead-letter. A `sync_runs` row is written at start and updated at finish, including on failure. A scheduler that enqueues nightly work per active tenant. A `pnpm worker:sync <tenantId>` command for manual runs.

**Done when** a deliberately failing job retries three times, lands in the dead-letter queue, and leaves a `sync_runs` row with status `failed` and the error recorded.

### 0.6 — Admin auth
Single admin user. Email plus password plus TOTP. Session cookie scoped to the admin app. No signup route, no password-reset email flow, no roles. A seed script creates the admin from environment variables.

**Done when** the admin app has one protected page showing the tenant list from the database, and every other route redirects to login.

### 0.7 — Marketing one-pager
Astro site: product name, one-line description, three sentences on what it does, contact email, privacy policy, terms. Deploy to Cloudflare Pages on `getgrossline.com`.

**Done when** it is live, because the Google Ads developer token application needs a real URL.

---

## Exit criteria

- Two tenants exist with fully isolated data, proven by test
- Credentials encrypted at rest, proven by test
- A job can be enqueued, fail, retry and be recorded
- Admin can log in and see the tenant list
- `getgrossline.com` is live
- `pnpm verify` passes from a clean clone

## Not in this phase

Connectors. Metrics. Reports. Findings. Merchant portal. Billing. Any UI beyond the tenant list.
