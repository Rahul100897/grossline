# Phase 3 — Admin console

Goal: run the whole business from the browser. Onboard a merchant, spot anything broken, do the monthly analysis, raise an invoice, answer a ticket — without touching the database or the terminal.

You are the only user. No merchant login, no roles, no signup. One admin row.

**Design reference:** `docs/design/admin-mockup.html`. Commit it if it isn't already. It is a visual target, not a component library — match the density, the palette and the table-first layout, not the markup.

---

## Design direction

**Palette:** ink `#14181F`, paper `#FAFAF7`, slate `#5C6470`, hairline `#E6E5DF`, green `#1F7A5C` for good, rust `#B4472B` for attention. Grey is the default state. Colour appears only where a number needs a verdict — a screen where everything is coloured says nothing.

**Type:** one family with tabular figures, mandatory. Columns of money must align. Numbers carry the visual weight, labels stay small and quiet. No all-caps labels.

**Layout:** dense over airy. Real tables, not cards pretending to be tables. Tight vertical rhythm. Wide tables scroll horizontally inside their panel on narrow screens rather than collapsing into cards — card collapse destroys the column alignment that makes numbers comparable.

**Responsive:** works on a phone. Sidebar goes off-canvas below 900px.

**Avoid:** identical rounded cards with the same shadow, gradient washes, a coloured stat-tile grid on every page, monospace as decoration.

**Every page needs an empty state and an error state.** With one dev tenant and one demo tenant, empty is the state you will see most.

---

## Tasks

### 3.1 — App shell

Sidebar navigation, page chrome, the design tokens above as Tailwind theme values, shared table and panel primitives, off-canvas sidebar on mobile. Every subsequent task uses these — no page invents its own table.

**Done when** navigation works, tokens are defined once, and a table primitive renders with correct tabular alignment at every breakpoint.

### 3.2 — Overview

The morning screen. Monthly recurring revenue, collected this quarter, open issues, reports due. Then "needs your attention": anything blocking, ranked by what it costs you today. Not a stat wall — four numbers and a prioritised list.

**Done when** it surfaces every blocking issue across all tenants without you clicking into anything.

### 3.3 — Merchants

List: name, stores, joined date, plan, monthly fee, their ad spend last month, billed to date, connection health, status. Search and filter by plan and status.

Detail page with tabs: Overview, Connections, Stores, Metrics, Billing, Notes. The cost inputs page from task 2.2 folds in here rather than living separately — do not duplicate it.

Creating a tenant must be possible from the UI. It is currently a CLI-only operation and that is the single biggest reason you would still open a terminal.

**Done when** you can create a tenant, connect a store and see its health without leaving the browser.

### 3.4 — Issues

Every problem across every merchant in one place, whatever its kind: broken connection, sync failure, stale or missing cost data, reconciliation variance, overdue invoice, stuck onboarding, incomplete backfill.

Each issue carries severity, type, merchant, age, and the action that resolves it. Free-text search plus filters on severity and type. Blocking issues — the ones stopping a report going out — rank first.

Issues are **derived**, not a table you write to. A connection that recovers stops being an issue without anyone marking it resolved. Keep a resolved history for 90 days.

**Done when** every condition the system already knows about surfaces here, and nothing requires reading logs to discover.

### 3.5 — Metrics explorer

Where you actually do the analysis. Pick a tenant and a period, see every metric from Phase 2 with comparisons, drill from monthly summary to daily to campaign.

Non-negotiable display rules, all of which the metric layer already provides:
- Absent is absent. Never render a missing value as zero or a dash that reads like zero.
- Completeness meta shown wherever margin appears — a margin over 60% of SKUs is labelled as such.
- Provisional flags shown on cohort metrics whose window has not closed.
- Platform-reported figures visually distinct from blended ones, and never adjacent in a way that invites summing.
- Cost provenance visible: merchant-uploaded versus epoch-assumed.

**Done when** you can answer "what happened last month and why" for the demo tenant without running a single command.

### 3.6 — Billing

Invoices: number, merchant, period, amount, due date, status. Payments received with the Xflow fee and net INR. Revenue by plan. Upcoming renewals, including design-partner rates about to expire.

Invoice PDF generation with your business details, the zero-rated LUT wording for export of services, and quarterly period lines. Same Playwright HTML-to-PDF approach the monthly report will use later — build it so Phase 5 inherits the plumbing.

Manual status marking. No payment gateway. You mark an invoice paid when Xflow settles.

**Done when** you can create, preview, download and mark an invoice paid, and the quarter's totals reconcile against what you actually received.

### 3.7 — Support inbox

A `tickets` table: type (bug, question, feedback, feature), subject, body, submitter, tenant, status, priority, notes, timestamps.

Two intake points, one destination: a form on the marketing site, and an in-app widget in the console for your own bug log while building. Email notification to you on arrival.

**Done when** a ticket submitted from the marketing site appears in the inbox and you can reply and close it.

### 3.8 — Settings

Metric definitions rendered from `docs/metrics.md` so the page can never drift from the source of truth. Default thresholds. Plan prices. Alert preferences. Business and invoicing details. Admin account.

**Done when** the definitions page renders the committed document and a definition change appears without a code change.

### 3.9 — Reconciliation panel

Surface the 1.7 harness in the UI. Per tenant and month: your total, the platform's figure, the variance, the tolerance, and the structural explanation where one applies.

**Done when** you can run a reconciliation from the browser and read the result without the terminal.

---

## Not in this phase

Findings engine — Phase 4. Report generation and the monthly PDF — Phase 5. Merchant-facing portal. Anything that interprets a number rather than displaying it.

The nav should not carry a Reports item yet. Do not build placeholder pages.

## Exit criteria

- A full month for one merchant can be run start to finish in the browser: check health, review metrics, reconcile, invoice
- Tenant creation, connection and cost input all possible from the UI
- Every page has an empty state and an error state
- Usable on a phone
- Absent, provisional, completeness and provenance all visible wherever they apply
- `pnpm verify` green
