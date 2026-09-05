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

- **Direct pushes to `main`.** README says `main` is protected with PR-only
  merges. Branch protection is a GitHub setting that does not exist yet on a
  fresh repo, and the instruction for this bootstrap phase was one commit per
  task pushed after each. Phase 0 commits therefore go directly to `main`;
  turn on branch protection before Phase 1.
