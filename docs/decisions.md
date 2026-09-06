# Decisions log

Decisions made during autonomous implementation that were not fully specified
in CLAUDE.md or the phase docs. Each entry says what was decided and why the
simplest option was chosen. Anything here can be revisited.

## 2026-09-05 — Repo bootstrap

- **Git state.** `github.com/Rahul100897/grossline` had zero commits and zero
  refs (verified with `git ls-remote`). "Preserve remote history and rebase
  onto it" was therefore a no-op: the local directory was `git init`-ed on
  `main` with `origin` pointing at the GitHub repo, and history starts here.
  Nothing was force-pushed or discarded.
- **`.env.example` values blanked.** All previously non-empty values were
  local-dev defaults or API version strings, not credentials
  (`NODE_ENV=development`, localhost `DATABASE_URL`/`REDIS_URL`,
  `MASTER_KEY_VERSION=1`, `SHOPIFY_API_VERSION=2026-07`,
  `META_API_VERSION=v21.0`). They were moved into comments so local setup
  stays documented. **No real credentials were found; nothing needs rotating.**
- **`.gitignore` merge.** Remote had no `.gitignore` (empty repo), so the
  local version stands. It already covered `.env`, `.DS_Store`,
  `node_modules/`, `docs/scratch/`. Added `.claude/settings.local.json`
  (session-local Claude Code permission state, not shared config).
- **Scratch clone.** `~/Documents/grossline-repo` (created in an earlier
  session as a staging copy) is now redundant — every file in it exists in
  this repo. It was left in place because deleting directories was out of
  scope for autonomous mode; safe to delete manually.
## 2026-09-05 — Task 0.1 monorepo scaffold

- **Local ports 5433/6380.** This machine already runs Postgres on 5432 and
  Redis on 6379 for other projects, so `docker-compose.yml` maps grossline to
  5433 (Postgres) and 6380 (Redis). CI uses the standard ports via service
  containers; nothing in code hardcodes either — everything reads
  `DATABASE_URL` / `REDIS_URL`.
- **Separate test database.** `docker/initdb` creates `grossline_test` next to
  `grossline`. Tests use `TEST_DATABASE_URL` when set, falling back to
  `DATABASE_URL` (CI points `DATABASE_URL` straight at its test database).
- **No build step for internal packages.** `@grossline/core` and
  `@grossline/db` export TypeScript source directly; consumers run it via
  tsx/vitest, and Next uses `transpilePackages`. Simplest thing that works for
  a repo where nothing is published; revisit if a deploy target needs JS.
- **Tailwind now, shadcn/ui when there is real UI.** Tailwind v4 is wired into
  the admin app because it is the stack. shadcn/ui component installs are
  deferred until a task actually needs components beyond a form and a table.
- **`seed:demo` deferred.** CLAUDE.md lists it, but "18 months of sample data"
  requires the raw tables and connector shapes that only exist from Phase 1.
  The root script exists and fails with an explanation. `seed:admin` (task
  0.6) is separate and does exist.
- **`--passWithNoTests`** on packages whose test suites land in later tasks,
  so `pnpm verify` is meaningful from the first commit.

## 2026-09-05 — Task 0.2 core schema

- **`credentials.provider` added.** The phase spec's column list omits it, but
  `putCredential(tenantId, provider, payload)` (task 0.4) needs to record which
  provider a credential belongs to. Not a `raw_*` table, so this did not need
  sign-off, but flagging it: one enum column, nothing else changed.
- **`audit_log.tenant_id` is nullable.** Admin-level events (login, tenant
  creation) have no tenant. RLS still applies: a tenant context only sees its
  own rows; tenant-less rows are visible only to the admin connection.
- **RLS enforcement model.** The app connects as `grossline_app`
  (`NOBYPASSRLS`, owns nothing, no access to `admin_users`); policies key on
  `current_setting('app.tenant_id', true)`, which is NULL outside a tenant
  context, so unscoped queries return zero rows. The migration/admin
  connection (`DATABASE_URL`) is for migrations and explicit cross-tenant
  admin reads inside `packages/db` only. The `grossline_app` role is created
  in a migration with a fixed local password — acceptable for local/CI;
  production must set `APP_DATABASE_URL` with a managed secret.
- **`sync_runs.connection_id` nullable** so a run can be recorded even when a
  job fails before resolving its connection (task 0.5 writes a failed row in
  every path).

## 2026-09-05 — Task 0.4 credential store

- **`getCredential(tenantId, ref)`, not `getCredential(ref)`.** The phase doc
  writes the one-argument form, but CLAUDE.md non-negotiable #1 says no read
  without a tenant filter — and the two rules conflict. CLAUDE.md wins: the
  lookup runs through `withTenant`, so a ref belonging to another tenant
  resolves to `null` under RLS instead of ever loading the row.
- **Envelope format.** Wrapped data key + auth tags travel as a versioned
  JSON envelope inside the `ciphertext` column; the payload IV uses the
  schema's `iv` column. Rotation: `key_version` names the wrapping key;
  the current key is `MASTER_KEY` (version from `MASTER_KEY_VERSION`,
  default 1) and superseded keys will be provided as `MASTER_KEY_V<n>` during
  a rotation window.

## 2026-09-05 — Task 0.5 job runner

- **Queue names are `sync-<tenantId>`** (BullMQ forbids `:` in queue names).
  Redis keys are prefixed `grossline` (`grossline-test` under tests) so suites
  never collide with a running worker.
- **New tenants need a worker restart.** The worker creates one BullMQ worker
  per tenant queue at startup. Watching for new tenants at runtime is
  deliberately out of scope for Phase 0; restart the worker after creating a
  tenant. Revisit when tenant creation stops being a manual act.
- **`drizzle-orm` (query builders only) is allowed outside packages/db.** The
  lint ban covers the client entrypoints (`pg`, `drizzle-orm/node-postgres`),
  not operators like `eq` used against the transaction that `withTenant`
  hands out — that is the intended way to write tenant-scoped queries.
- **One `sync_runs` row per job, not per attempt.** The run id is written back
  into the job data on the first attempt; retries reuse it, and the final
  failure marks the row `failed` before the job is copied to the `dead-letter`
  queue.

## 2026-09-05 — Task 0.6 admin auth

- **No auth dependencies.** Password hashing is node `scrypt` (OWASP params),
  TOTP is RFC 6238 implemented on node `crypto` (verified against the RFC test
  vector), sessions are HMAC-SHA256 tokens over Web Crypto so the same code
  verifies in Next.js edge middleware. Avoids adding bcrypt/otplib/jose, which
  CLAUDE.md says to ask about.
- **Seed accepts `ADMIN_PASSWORD_HASH` (preferred) or `ADMIN_PASSWORD`**
  (hashed on the spot, minimum 12 chars) and generates + prints the TOTP
  secret once when `ADMIN_TOTP_SECRET` is absent. Re-running the seed updates
  the same single admin row (upsert on email).
- **Sessions last 12 hours**, cookie `grossline_admin_session`, httpOnly,
  SameSite=Lax, Secure in production. Login failures are indistinguishable
  (wrong email vs password vs TOTP) and both outcomes are audit-logged.
- **Live verification done**: redirect-to-login on every route without a
  session, generic error on bad credentials, tenant list (empty state and
  populated) after real login, sign-out returns to login.

## 2026-09-05 — Exit criteria pass

- **Non-production env fallbacks** matching docker-compose (DATABASE_URL,
  REDIS_URL, and a clearly-labeled dev MASTER_KEY) so `pnpm verify` passes on
  a fresh clone with no `.env`. All refuse to fall back when
  `NODE_ENV=production`. Verified with an actual clean clone from GitHub.
- **CI fixes**: removed the pnpm version pin (the `packageManager` field is
  the single source of truth), replaced the CI test MASTER_KEY with one that
  really decodes to 32 bytes, and marked that labeled test value
  `gitleaks:allow`. CI (verify + secrets scan) is green on main.
- **`getgrossline.com` is NOT live** — the only unmet exit criterion. It needs
  Rahul's Cloudflare account; the exact steps are in `docs/deploy.md`.

## 2026-09-05 — Task 1.1 connector framework

- **Dynamic queues: one shared `sync` queue with the tenant on the job.** Of
  the two options the spec offers, this is the simpler: no registry, no
  watchers, no restart — a tenant created a second ago syncs immediately
  (proven by test). Per-tenant queue fairness matters at hundreds of tenants,
  not two; revisit if one tenant's backfill ever starves another's nightly
  sync. Phase 0's queue-per-tenant code is gone.
- **Cursor model.** `sync_cursors` (tenant-scoped, RLS) holds one row per
  (connection, stream): backfill cursors advance per committed chunk,
  incremental holds a provider watermark. A backfill window mismatch is an
  error, not a silent restart — clearing cursors is the explicit reset.
- **Rate limiting** is per-response, not fixed sleeps: `fetchWithRetry` takes a
  platform-specific delay extractor, falls back to `Retry-After`, then jittered
  exponential backoff.
- **Connection failure semantics.** A job that exhausts retries marks the
  connection `degraded` with the error; `healthy` plus `last_success_at` on
  every success. `broken` is reserved for explicit health-check failures
  (e.g. Google's unlinked-account state, task 1.4).

## 2026-09-05 — Task 1.2 Shopify connector

- **Backfill windows: orders by `created_at`, customers/products by
  `updated_at`.** Created-at gives complete period coverage for orders (the
  node is fetched in its *current* state, so later refunds ride along even in
  old windows). Customers/products have no meaningful creation window; anything
  touched in the backfill window is captured and incremental keeps them fresh.
  Known gap: a customer or product untouched for >13 months is absent until
  its next update — surfaced in Phase 2 as a data issue, not silently zero.
- **Incremental watermark = sync start minus 5 minutes**, not max(updated_at)
  seen. Overlap re-fetches a few rows; upserts make that free, and clock skew
  can never lose rows.
- **No real store available** — all fixtures are synthetic (filename prefix
  `synthetic-`, listed in the fixtures README and the phase handover). The
  fake fetch serves real API shapes (bulk-op lifecycle, JSONL with
  `__parentId`, paginated incremental); switching to a live store is
  `pnpm connect:shopify` — configuration only.
- **JSONL reassembly** indexes every gid-carrying object (including refunds
  inline in orders) and attaches flattened children by `__parentId`; an
  orphaned child is kept as a root flagged `__orphaned` rather than dropped.
- **Raw upsert semantics.** `raw_shopify_*` rows are only ever replaced by a
  *newer platform payload for the same gid* (that is what idempotent re-sync
  means); no derived values are ever written into them.

## 2026-09-05 — Task 1.3 Meta connector

- **Account-level rows use `campaign_id = ''`**, not NULL, so one plain unique
  index (tenant, connection, level, campaign_id, date) covers both levels.
- **Incremental ignores the watermark on purpose**: every sync re-pulls the
  trailing 28 days at both levels because Meta restates recent figures — a
  fetch-once design silently drifts. Proven by test (restated day replaced in
  place, row count unchanged).
- **Attribution setting stored twice, deliberately**: `attribution_setting`
  requested on every insights row (travels in the payload), and the account's
  `attribution_spec` snapshot on `connections.settings` at connect time.
- **Unique-metric caps**: chunks whose window ends more than 13 months ago
  drop `reach`/`frequency` from the field list (Meta caps unique counts at 13
  months, frequency at 6); totals fields are pulled for the full 37 months.
- **Rate limits**: Meta signals throttling as HTTP 400 + error codes
  (4/17/32/613/80000/80004) and the `X-Business-Use-Case-Usage` header's
  `estimated_time_to_regain_access` — the client honours that signal first,
  exponential backoff only as fallback.
- **No real ad account available** — all fixtures synthetic and marked;
  switching to a live account is `pnpm connect:meta` — configuration only.

## 2026-09-05 — Task 1.4 Google Ads connector

- **REST `googleAds:searchStream`, not the gRPC client library.** Zero new
  dependencies, plain fetch, easy to fixture. Revisit only if we need
  services beyond reporting queries.
- **Incremental re-pulls a trailing 30-day window** (mirroring Meta's 28):
  Google conversions restate for weeks after the click. Upserts on
  (campaign, date) make the re-pull free.
- **Unlinked accounts are connection state, not crashes.** A
  PERMISSION_DENIED/USER_PERMISSION_DENIED response raises a typed error;
  the connection is marked `broken` with the exact linking instruction, and
  `pnpm connect:google` still records everything so re-linking needs no
  reconfiguration. Linking is a per-account onboarding step.
- **Developer token at Test access → Basic Access switch-over** (config only):
  1. While at Test access, only *test* MCC hierarchies answer; connect the
     test MCC id via `GOOGLE_ADS_LOGIN_CUSTOMER_ID` and a test client account.
  2. When Basic Access is granted (needs getgrossline.com live and the
     application approved), change `GOOGLE_ADS_LOGIN_CUSTOMER_ID` (or the
     per-connection `settings.loginCustomerId`) to the production MCC, link
     each client account to that MCC, and run `pnpm connect:google` per real
     account. No code changes.
- **OAuth**: one refresh token per tenant (credential), client id/secret and
  developer token from env, access tokens cached in memory until expiry.

## 2026-09-05 — Task 1.5 timezone & currency normalisation

- **FX source: Frankfurter (ECB daily reference rates).** Free, keyless,
  reliable, and the rates are the ECB's own. Stored base-EUR in the global
  `fx_rates` table; any pair converts via the EUR cross rate. Weekends and
  holidays use the most recent prior business day (≤7 days back) and the
  returned `rateDate` says which one — every converted amount carries
  `{ rate, rateDate, source }` and is reproducible.
- **`fx_rates` is global reference data** — the one new exception (alongside
  `admin_users`) to "every table has tenant_id". A rate is a fact about the
  world, not about a tenant; duplicating rows per tenant would add risk, not
  isolation.
- **One boundary source**: `monthWindow(reportingTz, y, m)` returns the UTC
  instants (for timestamped data) *and* the date labels (for platform daily
  rows) of a reporting month. A platform day is never re-cut into another
  timezone — it belongs to the month whose label it carries; the residual
  difference is a documented structural variance for reconciliation.
- **Conversion is exponent-aware** (JPY/KRW 0-decimal, KWD 3-decimal) over
  integer minor units; floats are rejected loudly.
- **Nightly FX pull** refreshes the trailing 7 days for every currency in use;
  `pnpm fx:pull [days]` backfills (needed once before Phase 2 computes
  anything over history).

## 2026-09-05 — Task 1.6 backfill orchestration

- **Default backfill windows**: Shopify 13 months (the spec's requirement;
  more is possible later by re-running with a wider window), Meta 37 months
  (its totals cap — our own database becomes the only long history), Google
  Ads 37 months for parity. `pnpm worker:sync <tenant> backfill` computes the
  window per provider; nothing is hand-passed.
- **Progress lives in the cursor rows** — no extra state to drift. The db-level
  `getBackfillProgress` is shared by worker and admin console;
  `PROVIDER_STREAMS` in core keeps the console from importing worker code and
  is asserted against the connectors in tests.
- **Partial histories are visible**: `backfill_completed_at` stays NULL until
  every stream finishes (the console shows "N% (partial)"); `resetBackfill`
  is the explicit way to change windows.

## 2026-09-05 — Task 1.8 demo tenant seed

- **Deterministic generator** (fixed-seed PRNG, stable gids): re-running
  `pnpm seed:demo` upserts the identical rows — idempotency for free, proven
  by test. Payload shapes mirror the connector fixtures so downstream code
  cannot tell demo data from synced data.
- **Demo "connections" exist but are internal**: the raw ad tables hang off
  `connection_id`, so the seed mints credential-less connections flagged
  `settings.demo = true`. No external account, no credential, nothing to sync.
- **Narrative encoded in the curve and proven by test**: Q4 spike (Nov 1.9×),
  discount-heavy month (month 3, ~70% of orders discounted), Trailhead Flask
  ~25% refund rate, Aurora Mug stockout (month 8, days 5–25), Google
  `pmax-underperformer` with ROAS < 1 next to `search-brand` above 3.
- Scale: ~3.4k orders / ~2.1k customers / ~2.7k ad-day rows over 18 months —
  believable for a small DTC brand and fast enough to seed in tests.

## 2026-09-05 — Task 1.7 reconciliation harness

- **Totals follow docs/metrics.md, computed in TypeScript over raw payloads.**
  This is deliberately not the Phase 2 metric layer (which will be raw SQL
  into `metrics_*`); it is the independent yardstick the metric layer will be
  checked against. Noted in docs/phase-2-notes.md.
- **Comparisons happen in each platform's own currency** — the platform UI
  shows its own currency, so converting first would smuggle FX noise into
  every variance.
- **Tolerances**: orders and new customers exact; net sales 0.5%; Google 1%
  and Meta 2% (the tasks' own exit criteria). An out-of-tolerance variance
  passes only with a written explanation in the expected file; the harness
  exits non-zero otherwise.
- **"Matches the live UI" is not satisfiable without real accounts.** The
  harness logic is proven against the demo tenant with golden values
  (variance 0.000% across three months); the manual read-and-record procedure
  is docs/reconciliation.md.

## 2026-09-05 — Optional TOTP for local development

- **`ADMIN_TOTP_DISABLED=true` skips the authenticator step**, at Rahul's
  request, for local convenience. Access-control change, so scoped hard:
  the flag is a no-op when `NODE_ENV=production`, the default is TOTP-on,
  the secret stays enrolled in the database, and the login page hides the
  field only when the flag is active. Remove the flag from `.env` to
  restore two-factor locally.

## 2026-09-05 — /connections display truthfulness

- **Health gains an `unknown` state ("never synced") and it is the default.**
  `healthy` now requires evidence — a successful sync sets it, nothing else
  does. The migration recreates the enum via a text cast (Postgres refuses to
  use a value added by `ALTER TYPE … ADD VALUE` inside the same transaction)
  and resets any never-synced/never-errored row from the old optimistic
  default.
- **Seeded demo connections render as `demo` / `seeded`** — the seed bypasses
  sync cursors, so any progress percentage would be fiction. The seed now also
  mints the Shopify demo connection and marks pre-existing matching
  connections `settings.demo = true`.

## 2026-09-05 — Shopify auth strategies (auth model change)

Verified against shopify.dev: admin-created ("legacy") custom apps cannot be
created since 2026-01-01 (existing shpat_ tokens keep working); Dev Dashboard
apps authenticate via OAuth — the client credentials grant works only for
stores in our own Shopify organization and returns ~24-hour tokens; merchant
stores need custom distribution plus the authorization code grant;
`read_all_orders` is a restricted scope and without it Shopify silently
returns only the last 60 days of orders.

- **Strategy per connection** (`settings.authStrategy`): `legacy_static`,
  `client_credentials`, `authorization_code`. Connections predating this
  change default to `legacy_static`.
- **Client-credentials tokens are never persisted or logged** — they are
  re-derivable, so they live in an in-memory cache and refresh proactively
  five minutes before expiry. Only the client id/secret are stored
  (encrypted, like every credential).
- **Authorization-code offline tokens ARE stored encrypted** — they cannot be
  re-derived. The install URL is printed by `pnpm connect:shopify …
  authorization_code` with a signed one-hour state token carrying the tenant;
  the flow completes in the admin app's `/api/shopify/callback` (hmac +
  state verified, shop domain anchored), which is exempt from session
  middleware because it authenticates cryptographically. Redirect URI comes
  from `SHOPIFY_REDIRECT_URI` (localhost now, getgrossline.com later).
- **Missing `read_all_orders` is a standing warning, not a silent short
  backfill**: connect and OAuth completion write `settings.scopeWarning` and
  degrade the connection naming the 60-day limit; a successful sync keeps the
  connection degraded (with `last_success_at` still recorded) until the scope
  is granted and connect is re-run.
- Not implemented yet: Shopify's *expiring* offline tokens (90-day refresh
  tokens, currently required only for new public apps). Ours is custom
  distribution; revisit if Shopify extends the requirement.

## 2026-09-05 — Task 2.1 product costs

- **Cost rows key on sku and/or variant gid** (both stored, '' = unset, CHECK
  requires one). Resolution: variant match beats sku match, latest
  effective_from ≤ order date wins, and on a full tie a merchant `upload`
  beats the `shopify` sync. Missing stays `null` — never zero.
- **Shopify unitCost import dating.** Shopify keeps no cost history, so the
  first sighting of a variant's cost applies from 1970-01-01 (already-synced
  history resolves); a *changed* cost inserts a new row effective the import
  date, freezing history. Merchant CSV uploads override via the tie-break.
- **CSV upload is a CLI** (`pnpm costs:upload`), not an admin page — Rahul is
  the only user and lives in a terminal; per-row line-numbered error report,
  valid rows applied, exit 1 when any row fails. Coverage
  (`pnpm costs:coverage <tenant> <YYYY-MM>`) reports costed-line share plus
  missing SKUs with units and discounted revenue at stake, cancelled orders
  excluded; exits 1 when anything is missing so it is cron-visible.
- Coverage revenue uses the **discounted** line revenue in shop currency —
  the number closest to what net sales will lose if the line stays uncostable.

## 2026-09-05 — Task 2.2 merchant cost inputs

- **Whole-row snapshots, not per-field versions.** Each save of
  `tenant_cost_inputs` is a complete snapshot from its effective date;
  resolution picks the latest snapshot on/before the date (the same
  `latestEffective` helper products costs use — one implementation of
  "historical months never change"). A field a snapshot does not supply is
  missing for that era — not inherited from the previous snapshot, not zero.
  Simplest model that is unambiguous about what applied when.
- **Percentages as integer basis points** (290 = 2.90%): the no-float money
  rule extends to rates we multiply money by. Fixed fees and targets are
  integer minor units with the snapshot's currency.
- **metrics.md updated in the same PR** (packaging cost, monthly targets,
  effective-from dating documented) with a changelog entry — the spec
  mandates these inputs and the definitions doc is the single source.

## 2026-09-05 — First live Shopify API contact (rahul-developer-store)

Three real differences from the synthetic fixtures, found and fixed:

1. **`customerJourneySummary.momentsCount` is an object** (`Count { count
   precision }`), not a scalar, in API 2026-07. Query and fixtures corrected.
2. **Bulk operations reject a connection nested inside a list field** — the
   `refunds → refundLineItems` selection is refused live ("Queries that
   contain a connection field within a list field are not currently
   supported"). Fix: the bulk query carries refund *headers* only, and the
   connector enriches refunded orders afterwards with per-order
   `node(id:){ refunds { refundLineItems(first:100) } }` queries (validated
   live; supported outside bulk). Final stored payload shape is unchanged.
3. **A Dev Dashboard app version released without scopes issues tokens with
   an empty scope set**: the token grant succeeds, `shop` info works, and
   every data field answers "Access denied". The token's `scope` field and
   `currentAppInstallation.accessScopes` are readbacks of what the installed
   version was approved with — both empty here. New `NO_SCOPES_WARNING`
   distinguishes this from the missing-`read_all_orders` 60-day warning, and
   a bulk ACCESS_DENIED failure now carries the remediation hint.

State after this session: real tenant `rahul-developer-store` (USD,
America/New_York — taken from the store at connect time) with a
client_credentials connection, health honestly `degraded` (no-scopes
warning), **zero raw rows** — the backfill fails with ACCESS_DENIED until the
app version is released with scopes and approved on the store (Rahul-side
Dev Dashboard action). Backfill cursors were reset so the re-run starts
clean. Fixture replacement with real recordings is blocked on the same.
Also noted: `read_all_orders` request card does not surface for Dev
Dashboard apps — the 60-day warning will stand even after scopes land.

## 2026-09-05 — Live backfill of rahul-developer-store

- **Scopes landed** (read_orders, read_customers, read_products,
  read_inventory — confirmed in the token readback); the connection's warning
  correctly downgraded from NO_SCOPES to the 60-day read_all_orders warning.
- **Live finding #4: protected customer data.** `email`/`displayName` are PII
  fields needing separate Shopify approval ("This app is not approved to use
  the displayName field"), denied even with read_customers granted — and the
  denial only fires on chunks that actually contain rows, which is why seven
  empty chunks passed first. **Decision: stop fetching customer PII
  entirely.** No metric in docs/metrics.md uses it ("new customer" keys on
  the store's customer record, never email), fixtures were being anonymised
  anyway, and less PII at rest is strictly better. Revisit only if a future
  phase genuinely needs it, via the protected-data approval process.
- **The interrupted live backfill resumed from cursors exactly as designed**
  (21 chunks skipped, 21 run) — the Phase 1 resume test held up against
  reality.
- **The store has zero orders** (`ordersCount: 0`; its customers'
  `numberOfOrders` show orders once existed and were deleted). Order fixtures
  therefore remain synthetic; customers/products fixtures are now REAL
  anonymised recordings, which also validated JSONL reassembly against
  genuine bulk output. One of five customers predates the 13-month
  updated_at window and is absent — the documented backfill gap, visible
  here in practice.

## 2026-09-05 — Seeded dev-store orders and real order fixtures

- **The write-to-a-store rule has exactly one sanctioned exception**:
  `services/worker/scripts/seed-dev-orders.ts`, dev-only, hard-guarded to
  refuse any store other than rahul-developer-store.myshopify.com (checked
  against both env and the connection's credential) and to refuse
  `NODE_ENV=production`. It exists because the metric layer needs real API
  shapes and the store is ours. Connectors remain strictly read-only.
- **Live finding #5: `refundCreate` requires `@idempotent(key:)`** on the
  mutation field in 2026-07 — sent with a fresh UUID per refund.
- **Live finding #6: order creation is rate-limited separately** ("Too many
  attempts") — the seed script takes a resume index instead of hammering.
- **`createdAt` cannot be set via orderCreate.** The 45-day spread lives in
  `processedAt`; all seeded orders share today's `createdAt`. Flag for task
  2.3: docs/metrics.md says order count uses "the order's creation
  timestamp" — Shopify Analytics itself keys on processedAt, and for these
  test orders only processedAt carries a realistic spread. **The 2.3 PR must
  resolve this in docs/metrics.md before computing anything** (metrics.md
  changes need sign-off — ask, do not decide).
- **Order fixtures are now real anonymised recordings** (10 orders: percent
  and fixed discount codes with allocations, partial/full refunds, a
  cancellation with automatic refund, repeat customer with order index 1→2,
  shipping charged vs free, tax lines, mixed quantities), including the
  per-order refund enrichment responses and a real incremental page.
  Synthetic fixtures survive only for multi-currency presentment and
  shipping-only refunds (impossible to produce in this store) and the
  incremental update-in-place pages. Real-data quirk kept: amounts trim
  trailing zeros ("8.8", "7.0").

## 2026-09-06 — Metric layer (tasks 2.3–2.10)

- **FLAG — deviation from CLAUDE.md's stack line "Raw SQL for metric
  queries":** metrics are computed in TypeScript over raw payloads (pure
  functions in `packages/core/src/metrics/`, orchestrated by the worker),
  writing to `metric_values` via the tenant-scoped helpers. Line-item money
  math over jsonb in SQL would be miserable, float-prone and untestable as
  pure goldens; the integer-minor-unit discipline lives in one place this
  way. The *storage* contract CLAUDE.md actually protects is intact: raw is
  never touched, metrics land in `metrics_*`-style tables, recompute is total
  and idempotent. Say the word and 2.x can be ported to SQL.
- **One generic `metric_values` table** (metric, grain, period, scope, value,
  currency, meta) instead of a table per metric family: the comparison engine
  works over every metric with one implementation, and new metrics need no
  migrations. Money = integer minor units in `value`; rates = 6-dp decimals;
  provisional/completeness/FX traces in `meta`.
- **Two kinds of golden.** Correctness goldens are HAND-CALCULATED expects
  with derivations in the test headers (per the pre-authorisation, values
  never come from the implementation). The committed golden FILES
  (`test/goldens/*.json`, regenerate with `UPDATE_GOLDENS=1`) are the
  change-visibility mechanism: a definition change turns into a readable
  per-metric diff in the PR. Demo-scale checks use an independent naive
  implementation committed inside the test.
- **Nightly**: the scheduler enqueues a `metrics` job per active tenant with
  a 30-minute delay after the sync fan-out (crude ordering; revisit with job
  dependencies if syncs ever run longer). Metrics jobs keep their own
  bookkeeping in `metric_runs` (with raw watermark), not `sync_runs`.
- **Pipeline `now` is injectable** so provisional flags and cohort offsets
  are reproducible in tests and the golden files cannot rot with the
  calendar.
- **Genuinely torn on (2.11 flag)**: gift cards — chose Analytics-matching
  (excluded at purchase) for reconciliation's sake, but it means gift-card
  cash flow is invisible in net sales until Phase 3 reporting decides how to
  show it. And COGS-on-net-units — metrics.md was silent; chose consistency
  with returns recognition over "cost of goods shipped".

## 2026-09-06 — Phase 3 start: housekeeping

- **Stack rule amended** (Rahul's acceptance of the flagged deviation):
  CLAUDE.md now reads "Raw SQL for aggregate queries, TypeScript for
  line-level money math over jsonb payloads".
- **The referenced design mockup did not exist.** `docs/design/admin-mockup.html`
  was in neither the repo nor Downloads, so it was AUTHORED from the spec's
  own Design direction section (palette, tabular figures, table-first
  density, colour-as-verdict) and committed as the visual target. Replace the
  file if a different reference exists — the console matches whatever this
  file shows.
- **The "frontend-design" skill is not available** in this environment
  (checked enabled and searchable skills); the spec's design rules are
  applied directly instead.

- **Direct pushes to `main`.** README says `main` is protected with PR-only
  merges. Branch protection is a GitHub setting that does not exist yet on a
  fresh repo, and the instruction for this bootstrap phase was one commit per
  task pushed after each. Phase 0 commits therefore go directly to `main`;
  turn on branch protection before Phase 1.

## 2026-09-06 — Task 3.3: Merchants

- **Costs is a seventh tab.** The spec enumerates Overview / Connections /
  Stores / Metrics / Billing / Notes and separately says the 2.2 cost-inputs
  page "folds in here". Cost inputs are neither billing (fees we charge the
  merchant) nor metrics (computed values), so they get their own tab rather
  than being buried in either. The old `/tenants/[id]/costs` route is gone.
- **Admin depends on `@grossline/worker` for store connects.** The connect
  flow (validate credential, read shop info, create store + encrypted
  credential + connection, evaluate scope warning) already exists once in
  `services/worker/src/connectors/shopify/connect.ts` with a clean import
  chain (core, db, zod — no BullMQ/Redis). Duplicating it in admin would
  fork the one place connection semantics live, so worker exposes it via an
  `exports` map (`@grossline/worker/shopify-connect`) and Next transpiles the
  workspace package. Workspace-internal wiring, not a new dependency.
- **Connect form falls back to env credentials.** Blank credential fields use
  SHOPIFY_STORE_TOKEN / SHOPIFY_CLIENT_ID / SHOPIFY_CLIENT_SECRET, same as
  the CLI — connecting our own dev store never means pasting a secret into a
  browser form. Meta/Google stay CLI-only (org-level credentials, still on
  fixtures per phase-1 handover).
- **`updateTenant` is a narrow admin-connection helper** (name, plan, status,
  fee fields, notes) — reporting currency/timezone and the slug are not
  editable from the UI; changing those has metric-layer consequences and
  stays a deliberate operation.
- **Backfill still starts from the CLI.** The 'never synced' issue row carries
  the exact command. Running syncs from the browser is worker-queue plumbing
  that belongs with the reconciliation-panel work (3.9) at the earliest.

## 2026-09-06 — Task 3.4: Issues

- **`issue_log` is a transition log, not a source of truth.** Issues stay
  derived (admin `lib/issues.ts`); the table exists only so the page can show
  a 90-day resolved history. `reconcileIssueLog` compares the derived open set
  against unresolved rows: new issues insert, still-open issues bump
  `last_seen_at`, and rows no longer derived get `resolved_at` set. A partial
  unique index (`resolved_at is null`) allows at most one open row per issue
  while letting a recurrence open a fresh row alongside the resolved history.
- **The Issues page load triggers reconciliation** — the one place a GET
  deliberately writes. This is a single-user internal console with no worker
  cron wired for issue reconciliation, so page load is the simplest honest
  trigger. If a scheduled reconcile is added later, it calls the same function.
- **Reconciliation-variance and overdue-invoice issue types are declared but
  not yet emitted** — their sources (the 1.7 harness surfaced in 3.9, invoices
  in 3.6) land in later tasks and add cases to the same derivation, consistent
  with issues being derived from whatever state exists.

## 2026-09-06 — Task 3.5: Metrics explorer

- **Comparisons are batched, not per-metric.** Rather than call the 2.9
  compareMetric engine ~40 times, the explorer reads three month snapshots
  (this month, previous, a year ago) with listMetricValuesForPeriod and
  diffs tenant-level rows in memory. Same MoM/YoY semantics (absent base →
  "no base", never a Δ against zero/absent), three queries instead of eighty.
- **Deltas render in the metric's own units**, not always as a percentage:
  money as money, rates as percentage points, ratios as ratio deltas. A "+4.6%"
  on a rate metric and a "+$2,230.00" on a money metric are both honest; a
  blanket Δ% would not be.
- **Cost provenance uses the same computeCostCoverage the CLI uses**, filtered
  on order createdAt via monthWindow (as costs:coverage does) — so the upload
  / shopify-dated / shopify-epoch-assumed split shown here matches the CLI.
  This coverage is createdAt-based; the margin metrics' completeness meta is
  processedAt-based (the reporting definition), so the two line counts can
  differ slightly — the panel is labelled "coverage", the margin badges carry
  the authoritative completeness.
- **Every metric is drillable.** Tenant-level metrics drill to their daily
  series; scoped metrics (ad_*, channel_*, platform_*) drill to the campaign/
  platform breakdown. Platform-reported rows (referenceOnly/neverBlended meta)
  are badged and carry a "not blended, not additive across platforms" note so
  they are never summed with blended figures.
- **Uncatalogued metrics still show** under an "Other" group, so a metric added
  in a later phase is never silently hidden from the explorer.

## 2026-09-06 — Task 3.6: Billing

- **Playwright is added for PDF rendering** — already the declared stack choice
  in CLAUDE.md ("Playwright for PDF rendering"), so this builds the stack, not
  a surprise dependency. Chromium installed via `playwright install chromium`.
- **The renderer exists in two runtimes on purpose.** The pure invoice template
  (`services/worker/src/billing/invoice-html.ts`) is the single shared source of
  the HTML. The HTML→PDF wrapper, however, lives twice: `services/worker/src/pdf`
  for the worker / Phase 5 report job (worker's own Node runtime), and
  `apps/admin/lib/pdf.ts` for the invoice download. Next's bundler follows
  Playwright's dynamic `require('chromium-bidi/...')` through any *transpiled*
  workspace package and fails to resolve it; importing Playwright *directly* in
  the admin app plus `serverExternalPackages: ['playwright','playwright-core',
  'chromium-bidi']` leaves it external and required at runtime. The 15-line
  wrapper is duplicated; the template that matters is not.
- **Invoice totals are never denormalised** — the total is always the sum of
  invoice_lines, computed on read. No amount column to drift.
- **Invoice numbers are globally sequential** (`GL-YYYY-NNNN`), allocated on the
  admin connection from the count of that year's invoices. One issuer, so global
  numbering is correct; the small single-user race is acceptable.
- **Net INR and the Xflow fee are entered, not computed.** Xflow settles USD
  invoices to INR externally; the analyst records what actually hit the bank
  (gross, fee, net INR, effective rate) when marking paid — so the quarter's
  collected total reconciles against the bank statement, never an FX estimate.
- **business_profile is a single global row** (no tenant_id, like admin_users) —
  the issuer's own details for the invoice PDF, including the zero-rated export
  LUT number. Task 3.8 provides the editing UI at /settings/business; 3.6 seeds
  it and reads it. The PDF falls back to a "set your business details" placeholder
  when it is absent.
- **Overview and merchant billing figures that were placeholders are now wired**
  (collected this quarter, billed/collected to date, merchants-list billed
  column) — they read real invoice/payment data now that it exists.

## 2026-09-06 — Task 3.7: Support inbox

- **Tickets are not tenant-scoped.** A marketing-site visitor has no tenant and
  no session, so tickets (and their reply thread, ticket_messages) live on the
  admin connection like audit_log, with a nullable tenant_id for in-app links.
  No RLS — there is no tenant to isolate by.
- **One intake function, two callers.** `intakeTicket` creates the ticket and
  best-effort emails the analyst; the public marketing route and the
  authenticated in-app widget action both call it. A failed notification never
  fails intake — the ticket is already saved and visible.
- **The public intake route is exempted from the admin middleware** (like the
  Shopify OAuth callback) and defends itself: strict Zod validation, a honeypot
  field (silently accepted, never stored — no bot signal), and permissive CORS
  so the static marketing site can POST cross-origin. No CAPTCHA, per the
  console's action rules.
- **Email is dependency-free** — a small fetch wrapper over Resend's REST API,
  not the SDK (avoids an ask-first dependency). It no-ops gracefully when
  RESEND_API_KEY is unset (dev), and the reply records whether it actually sent
  ("emailed" / "not emailed"), so nothing silently claims to have emailed.
- **The marketing form posts to the admin origin** via `PUBLIC_ADMIN_URL`
  (build-time public config, falls back to localhost:3000 in dev) rather than
  giving the static Astro site its own server runtime.

## 2026-09-06 — Task 3.8: Settings

- **Metric definitions render straight from docs/metrics.md** at request time —
  the page reads the committed file (walking up from cwd to the repo root) and
  renders it with a tiny dependency-free Markdown renderer (headings, lists,
  tables, bold, inline code, hr). No copy, no build step, so a definition edit
  appears with no code change — exactly the task's "done when".
- **A single app_settings row (jsonb blob)** holds plan prices, thresholds and
  alert preferences — new settings need no migration. It is the issuer's own
  config (no tenant_id), on the admin connection like business_profile.
- **Thresholds feed the issue engine.** deriveIssues now reads the configurable
  cost-completeness floor and onboarding-stale window from settings; the
  defaults match the previous constants, so behaviour is unchanged until edited.
- **The admin account page is read-only.** Password and TOTP rotation touch
  credential storage — an ask-first, CLI-only operation per CLAUDE.md — so the
  page shows email and 2FA status and points at the CLI rather than editing
  secrets from the browser.
- **Business & invoicing settings edit the business_profile from 3.6** (the
  invoice PDF issuer), completing the link the billing page already pointed at.
