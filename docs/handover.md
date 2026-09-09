# Grossline — full handover

The consolidated reference for the whole project. Per-phase detail lives in
`docs/phase-1-handover.md` … `docs/phase-4-handover.md`; metric definitions in
`docs/metrics.md`; every decision in `docs/decisions.md`. Read `CLAUDE.md`
first — it holds the non-negotiables and the current phase marker.

**Status: Phases 0–4 complete. Current phase: Phase 5 — Report delivery** (spec
not yet written).

---

## 1. What Grossline is

A reporting product for Shopify DTC brands. It pulls a merchant's Shopify
orders together with their Google Ads cost and Meta Ads spend, computes blended
commercial metrics, derives a small set of ranked, actionable findings, and (in
Phase 5) delivers a monthly PDF report. There is an admin console to run the
whole business from the browser.

The model is **analyst-with-a-tool**. Rahul is the only application user in v1 —
one admin login, no merchant accounts, no roles, no signup. Merchants receive a
PDF; a read-only portal is a later phase.

---

## 2. Architecture

pnpm-workspaces monorepo, TypeScript everywhere, Node 22.

```
apps/web              marketing site (Astro, static) — incl. /contact intake form
apps/admin            admin console (Next.js 15 App Router, Tailwind v4)
services/worker       connectors, metrics, findings, reports (CLIs + BullMQ jobs)
packages/db           Drizzle schema, migrations, tenant-scoped query helpers, RLS
packages/core         pure functions: metric math, findings rules, shared types
packages/config       eslint / tsconfig / prettier
docs/                 metrics.md, phase specs + handovers, decisions.md, reconciliation/
```

**Stack:** Next.js + Tailwind (admin), Astro (marketing), Postgres + Drizzle,
BullMQ on Redis (jobs), Zod at every boundary, Playwright for PDF, Resend for
email, the Anthropic Messages API for finding commentary, Vitest for tests.

**Boundary discipline:** `packages/core` is pure and has no database or network
access — it is where all money math and rule logic lives, so it is golden-test-
able from literals. `packages/db` owns every query and is the only place tenant
scoping happens. The worker orchestrates; the admin app reads through db helpers
and, where it needs worker logic (Shopify connect, PDF render, reconcile,
findings pipeline/commentary/calibrate), imports it through the worker package's
`exports` map.

**Local infra:** Postgres on `:5433`, Redis on `:6380`, via `docker-compose.yml`
on Colima. Start with `docker compose up -d` (restart Colima first if the
daemon socket is down).

---

## 3. The non-negotiables (from CLAUDE.md)

Breaking one is a bug even if tests pass.

1. **Every query is tenant-scoped** — through `packages/db` helpers; Postgres
   RLS (`app.tenant_id` setting, `grossline_app` role) is the second net.
2. **Raw platform data is immutable** — lands in `raw_*` tables untouched;
   metrics are a separate, always-recomputable step.
3. **Every sync is idempotent** — upsert on the platform's own id.
4. **Money is integer minor units**, always with a currency; converted amounts
   store the FX rate and its date.
5. **Dates stored UTC**; the reporting timezone is applied at query time.
6. **Every metric has a golden-file test.**
7. **No secrets in the repo**; tokens encrypted at rest; `.env.example` lists
   names only.
8. **Migrations are forward-only and reviewed.**
9. **Nothing merges without CI green** (typecheck, lint, tests, migration check).
10. **Definitions live in one place** — `docs/metrics.md`. Code that disagrees
    is the bug.

Things to **ask about, not decide**: new/changed metric definitions, any change
to `raw_*` schema, adding a dependency, anything touching encryption/token
storage/access control, and anything that would write to a merchant's Shopify
store or ad accounts (the answer is always no).

---

## 4. Data model

29 migrations (through `0028_rls_findings`). Tables:

- **Tenancy & auth:** `tenants`, `stores`, `connections`, `credentials`
  (encrypted), `admin_users`, `audit_log`.
- **Raw (immutable):** `raw_shopify_orders`, `raw_shopify_customers`,
  `raw_shopify_products`, `raw_meta_insights`, `raw_google_ads_insights`,
  `sync_runs`, `sync_cursors`.
- **Costs & FX:** `product_costs` (effective-dated, source shopify|upload),
  `tenant_cost_inputs` (effective-dated fees/targets), `fx_rates` (ECB daily).
- **Metric layer:** `metric_values` (metric × grain day|month × period × scope,
  numeric value + currency + meta jsonb), `metric_runs`.
- **Console (Phase 3):** `issue_log` (derived-issue transition log),
  `invoices`, `invoice_lines`, `payments`, `business_profile`, `tickets`,
  `ticket_messages`, `app_settings`.
- **Findings (Phase 4):** `tenant_calibration` (per-tenant thresholds),
  `findings`.

Every tenant-scoped table carries the standard `tenant_isolation` RLS policy.
Money everywhere is integer minor units.

---

## 5. What exists, phase by phase

### Phase 0–1 — Foundations & connectors
Monorepo, CI, RLS, encrypted credentials. Shopify connector with three auth
strategies (`legacy_static`, `client_credentials`, `authorization_code`); one
real dev store connected via client_credentials (`rahul-developer-store`).
Meta and Google Ads connectors are validated against recorded fixtures (org-
level credentials, CLI-connected; still on fixtures). Idempotent sync, protected
customer data never fetched. The **1.7 reconciliation harness** compares our
totals from raw against platform UI figures with tolerances and structural
explanations (`services/worker/src/reconcile.ts`, expected files in
`docs/reconciliation/expected/`).

### Phase 2 — Metric layer
Every metric in `docs/metrics.md` computes into `metric_values`, recomputable
from raw. Computers in `packages/core/src/metrics/*` orchestrated by
`services/worker/src/metrics/pipeline.ts`. Order date = **processedAt**
everywhere. Golden-file tests with hand-calculated expected values. A single
comparison engine (MoM / YoY / rolling) with absent-stays-absent semantics. Key
metrics: revenue (gross/net sales, discounts, returns, AOV, refund/cancel
rates), margin (COGS, gross profit, contribution, break-even ROAS with
completeness meta), customers (new/returning, repeat rates, cohorts,
first-order contribution), ad platforms (spend, CPM/CPC/CTR, platform ROAS —
reference-only), blended (MER, aMER, blended CAC, ad-spend share), channels
(store-recorded first/last touch, claim gap).

### Phase 3 — Admin console
Ten-item sidebar (off-canvas below 900px), design system with tabular figures
and dense tables, empty + error states on every page.
- **Overview** — four numbers + prioritised attention list.
- **Merchants** — list + detail tabs (Overview / Connections / Stores / Metrics
  / Costs / Thresholds / Billing / Notes); tenant creation and Shopify connect
  from the UI.
- **Issues** — derived, never stored; blocking-first; 90-day resolved history.
- **Metrics** explorer — comparisons + monthly→daily→campaign drill; the display
  rules (absent, completeness, provisional, platform-reported, provenance).
- **Billing** — invoices, payments (Xflow fee + net INR), revenue by plan,
  renewals; Playwright HTML→PDF invoices with zero-rated LUT wording; manual
  paid marking.
- **Support** — one inbox for the marketing-site form and an in-app widget;
  reply/close; Resend email notify.
- **Connections** — every platform connection's health/backfill.
- **Reconciliation** — the 1.7 harness in the browser.
- **Settings** — metric definitions rendered live from `docs/metrics.md`, plan
  prices, thresholds, alerts, business/invoicing details, admin account.

### Phase 4 — Findings engine
For any tenant and month: ranked, actionable findings with client-ready prose,
an editorial review gate, and recommendation tracking. See
`docs/phase-4-handover.md`. Enforced invariants: structured records first,
**the model never calculates** (a figure guard rejects any number not in the
record), missing inputs skip with a reason (never a finding on absent data),
money impact is the sort key, thresholds are per tenant, and "nothing needs
changing" is a real tested output. Nine golden-tested rules; a pure state
machine (new→recurring→resolved, sticky dismissals); ranking (impact floor, cap
3, claim-gap exempt); two-tier commentary (deterministic template + guarded
Anthropic narrative); recommendation history; and findings-as-issues (an
unreviewed month is blocking).

---

## 6. Running it

```
pnpm dev            admin + worker locally
pnpm verify         typecheck, lint, test, migration check — same as CI
pnpm db:migrate     apply migrations
pnpm seed:demo      raw demo data (Demo Brand, ~18 months of orders/customers/products)
pnpm seed:admin     create/update the single admin user (ADMIN_PASSWORD or _HASH; TOTP)
```

Worker CLIs (`pnpm --filter @grossline/worker <name> …`): `sync`,
`connect:shopify|meta|google`, `fx:pull`, `reconcile`, `costs:upload`,
`costs:import-shopify`, `costs:coverage`, `metrics:compute`, `metrics:recompute`,
`findings:calibrate`, `findings:compute`, `findings:draft`.

**Node:** `export NVM_DIR="$HOME/.nvm"; . "$NVM_DIR/nvm.sh"; nvm use 22`.

**Full demo (raw → findings), reproducible:**
```
docker compose up -d && pnpm db:migrate && pnpm seed:demo
DEMO=<demo tenant id>
pnpm --filter @grossline/worker costs:import-shopify $DEMO           # real COGS from raw payloads
for m in 2026-05 2026-06 2026-07 2026-08; do
  pnpm --filter @grossline/worker metrics:compute  $DEMO $m
  pnpm --filter @grossline/worker findings:compute $DEMO $m          # after calibrate
  pnpm --filter @grossline/worker findings:draft   $DEMO $m
done
pnpm --filter @grossline/worker findings:calibrate $DEMO --force     # run before findings:compute
```
This yields the demo's real finding set (recurring `payback_broken` + a
`claim_gap` measurement risk) and a multi-month recommendation history with a
resolved case.

**Console login (dev):** TOTP is disabled via `ADMIN_TOTP_DISABLED`; set a local
password with `ADMIN_PASSWORD='…' pnpm seed:admin` (inline, not in `.env`).

---

## 7. Testing & CI

- **Vitest.** `packages/core` (12 test files: metrics, money, time, costs, auth,
  and all findings goldens), `services/worker` (19 files: connectors, metric
  pipeline, agreement-with-reconcile, invoice HTML, job runner), `apps/admin`
  (Shopify install). `apps/web` type-checks.
- **Golden files** for metrics with hand-calculated expected values (shown in
  the PR, never generated by running the implementation); `UPDATE_GOLDENS=1`
  refreshes the change-visibility golden files.
- **Migration check** copies the migrations and re-runs `drizzle-kit generate`;
  any new file means schema drift.
- **CI** (GitHub Actions): `verify` + `secrets-scan` (gitleaks). Branch-per-task,
  PR, **wait for CI green**, squash-merge. `pnpm verify` passes on a clean clone.

---

## 8. Environment & deploy

One root `.env` (names in `.env.example`). Key vars: `DATABASE_URL` (5433),
`REDIS_URL` (6380), `SESSION_SECRET`, `ADMIN_EMAIL`/`ADMIN_TOTP_*`, Shopify
`SHOPIFY_CLIENT_ID|SECRET|STORE_TOKEN`, Meta/Google API creds, `RESEND_API_KEY`
+ `SUPPORT_FROM_EMAIL`, `PUBLIC_ADMIN_URL` (marketing→admin intake origin),
`ANTHROPIC_API_KEY` + `ANTHROPIC_MODEL`. No production deploy target is wired
yet; the app runs locally. Playwright needs Chromium
(`pnpm --filter @grossline/worker exec playwright install chromium`).

---

## 9. Current state & known gaps

- **Meta & Google Ads are still on recorded fixtures** (Phase 1). Only Shopify
  connects live, and only for the dev store. Real ad-platform connections are
  outstanding.
- **Entity-level findings rules are dormant on real data.** Dead-campaign,
  branded-search, search-term-waste and refund-outlier are golden-tested but the
  metric layer does not yet compute per-campaign order attribution, keyword
  reports, or per-product refunds — so they skip. Wiring those metrics unlocks
  them.
- **Backfills and metric/findings computation are CLI-triggered** (the console
  surfaces state and the exact command). No scheduled worker jobs for these yet.
- **Password/TOTP rotation is CLI-only** (ask-first, credential territory).
- The **demo margin depends on `costs:import-shopify`** having been run (the
  seed embeds unit costs in raw payloads but does not populate `product_costs`).
- Local DB currently holds the demo's Phase 4 findings/calibration for
  demonstration (not part of the seed).

---

## 10. What Phase 5 (Report delivery) inherits

- **The approved-set contract.** A finding is sendable when `approved_at` is set;
  its prose is `final_text` → `draft_text` → the live four-part template. The
  note already names next month's check-metric.
- **HTML→PDF plumbing exists** — the pure-template pattern
  (`services/worker/src/billing/invoice-html.ts`) and the Playwright wrapper
  (`services/worker/src/pdf/render.ts` for the worker/report runtime;
  `apps/admin/lib/pdf.ts` for Next, with Playwright kept `serverExternal`).
- **A month with unreviewed findings is a blocking issue** (`findings` type) —
  Phase 5 must not send an unreviewed month.
- Do **not** build the report before the Phase 5 spec exists (CLAUDE.md rule:
  no building ahead of the current phase).
