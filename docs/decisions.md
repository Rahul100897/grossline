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

- **Direct pushes to `main`.** README says `main` is protected with PR-only
  merges. Branch protection is a GitHub setting that does not exist yet on a
  fresh repo, and the instruction for this bootstrap phase was one commit per
  task pushed after each. Phase 0 commits therefore go directly to `main`;
  turn on branch protection before Phase 1.
