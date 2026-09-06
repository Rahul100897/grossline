# Phase 3 handover — Admin console

Phase 3 is complete. The whole business runs from the browser: onboard a
merchant, spot anything broken, do the monthly analysis, raise and settle an
invoice, answer a ticket, reconcile against the platforms — without touching
the database or the terminal.

One admin user (Rahul). No merchant login, no roles, no signup.

## What shipped, by task

| Task | What | Where |
|---|---|---|
| 3.1 App shell | Tokens, sidebar, off-canvas below 900px, shared table/panel/form primitives | `apps/admin/components/{ui,chrome,forms,tabs}.tsx`, `app/globals.css` |
| 3.2 Overview | Four numbers (MRR, collected this quarter, open issues, reports due) + a prioritised "needs your attention" list | `app/(console)/page.tsx`, `lib/issues.ts` |
| 3.3 Merchants | List with search/filter; detail tabs (Overview/Connections/Stores/Metrics/Costs/Billing/Notes); tenant creation and store connect from the UI | `app/(console)/merchants/**`, `lib/merchants.ts` |
| 3.4 Issues | One derived list across every merchant; search + severity/type filters; 90-day resolved history | `app/(console)/issues/page.tsx`, `packages/db/src/issue-log.ts` |
| 3.5 Metrics explorer | Tenant+month picker; every metric with MoM/YoY; monthly→daily→campaign drill; the display rules | `app/(console)/metrics/page.tsx`, `lib/metrics-explorer.ts`, `lib/metric-format.ts` |
| 3.6 Billing | Invoices, payments (Xflow fee + net INR), revenue by plan, renewals; Playwright invoice PDF; manual paid marking | `app/(console)/billing/**`, `packages/db/src/billing.ts`, `services/worker/src/{billing/invoice-html,pdf/render}.ts` |
| 3.7 Support inbox | Tickets from a marketing-site form and an in-app widget → one inbox; reply, close; email notify | `app/(console)/support/**`, `app/api/tickets/intake/route.ts`, `apps/web/src/pages/contact.astro` |
| 3.8 Settings | Metric definitions rendered from `docs/metrics.md`; plan prices, thresholds, alerts, business details, admin account | `app/(console)/settings/**`, `packages/db/src/settings.ts`, `lib/doc-render.ts` |
| 3.9 Reconciliation | The 1.7 harness in the browser: ours vs platform vs variance vs tolerance vs structural reason | `app/(console)/reconciliation/page.tsx` |

Nav order: Overview · Merchants · Issues · Metrics · Billing · Support ·
Connections · Reconciliation · Settings. **No Reports item** (Phase 5), no
findings, no placeholder pages.

## Design

Matches `docs/design/admin-mockup.html`: ink `#14181F`, paper `#FAFAF7`, slate,
hairline, green for good, rust for attention. Tabular figures everywhere, dense
real tables that scroll horizontally inside their panel on narrow screens, off-
canvas sidebar below 900px. Every page has an empty state and an error state.
Verified on desktop and a phone-width viewport.

**Absent stays absent** is enforced throughout: `formatMinor`/`formatMetric`
return `null` for missing input and the UI renders the `<Absent reason>` words,
never a zero and never a dash that reads like zero.

## Schema added this phase (migrations 0019–0026)

- `tenants` gained `plan`, `monthly_fee_minor`, `fee_currency`,
  `partner_rate_until`, `notes`.
- `issue_log` — transition log for the 90-day resolved history (issues stay
  derived; this only records openings/resolutions). RLS.
- `invoices`, `invoice_lines`, `payments` — billing, tenant-scoped, RLS.
- `business_profile` — the issuer's own invoice details (global row, no RLS).
- `tickets`, `ticket_messages` — support, admin-connection (nullable tenant).
- `app_settings` — one jsonb row for plan prices, thresholds, alert prefs.

All money is integer minor units; every tenant-scoped table has the standard
`tenant_isolation` RLS policy.

## Things worth knowing for Phase 4+

- **Issues are derived, never authored** (`apps/admin/lib/issues.ts`). Broken
  connections and scope warnings are blocking; degraded/never-synced, failed
  syncs, incomplete backfills, missing cost data and stalled onboarding are
  attention. New sources add a case here — **Phase 4 findings can surface as
  issues the same way**, and the reconciliation/overdue-invoice issue *types*
  are already declared for when their emitters are wired. Thresholds
  (cost-completeness floor, onboarding-stale window) are configurable in
  Settings and read by the engine.
- **The HTML→PDF path is shared plumbing for Phase 5.** The pure template lives
  in `services/worker/src/billing/invoice-html.ts`; the Playwright wrapper
  exists in two runtimes on purpose — `services/worker/src/pdf/render.ts` for
  the worker/report job, and `apps/admin/lib/pdf.ts` for the invoice download
  (Next bundles Playwright's dynamic requires if it comes through a transpiled
  package, so the admin route imports it directly and it is listed in
  `serverExternalPackages`). Chromium is installed via
  `pnpm --filter @grossline/worker exec playwright install chromium`.
- **Metric definitions and reconciliation expected-values render from committed
  files** (`docs/metrics.md`, `docs/reconciliation/expected/<slug>.json`), read
  from disk by walking up to the repo root — so they can never drift from
  source. Same mechanism if Phase 4 needs to render a committed rule doc.
- **Two workspace packages expose modules to the admin app** via `exports`
  maps: `@grossline/worker/{shopify-connect,invoice-html,pdf,reconcile}`.
  `@grossline/worker` is in the admin's `transpilePackages`.
- **Email** is a dependency-free fetch wrapper over Resend's REST API
  (`apps/admin/lib/email.ts`), a graceful no-op without `RESEND_API_KEY`, and it
  reports whether a send actually happened (no false "emailed").

## Still on fixtures / still CLI

- Meta and Google Ads connect from the CLI (org-level credentials); only
  Shopify connects from the browser. Both ad platforms are still on recorded
  fixtures (see `docs/phase-1-handover.md`).
- Backfills and metric computation still start from the CLI
  (`pnpm worker:sync`, `pnpm --filter @grossline/worker metrics:compute`); the
  console surfaces their state and the exact command to run.
- Password / TOTP rotation stays a CLI-only, ask-first operation.

## New env (see `.env.example`)

`SUPPORT_FROM_EMAIL`, `PUBLIC_ADMIN_URL` (marketing form → admin intake origin).
`RESEND_API_KEY` and `ADMIN_EMAIL` now drive ticket notifications and replies.

## Verification

- `pnpm verify` green on a clean clone of `main`.
- Every page checked live in the browser (desktop + phone width), zero console
  errors in fresh tabs.
- End-to-end flows exercised: created a tenant and connected a store; derived
  and resolved an issue (log transition confirmed in the DB); explored metrics
  with drill-down; created an invoice, downloaded its PDF, recorded a payment
  that reconciled the quarter; submitted tickets from both intake points and
  replied/closed one; saved settings that round-tripped; ran reconciliation for
  a tenant with and without an expected-values file.

Every decision taken this phase is logged in `docs/decisions.md` under the
2026-09-06 entries.
