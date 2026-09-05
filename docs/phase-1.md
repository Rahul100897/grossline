# Phase 1 — Connectors

Goal: 13 months of Shopify, Google Ads and Meta data for two real merchants, reconciled against each platform's own UI to a variance we can explain in one sentence.

No metric layer in this phase. No reports. Raw data in, correctly and repeatably. If you find yourself computing MER, you are in Phase 2.

**Build order matters.** Shopify first, because it needs no approval and unblocks everything. Meta second. Google last, because the developer token may still be pending — build it against a test account and switch when Basic Access lands.

---

## Tasks

### 1.1 — Connector framework

A shared shape every provider implements: `backfill(window)`, `incremental(since)`, `health()`. Cursor state per connection so a sync resumes rather than restarting. Rate-limit handling with respect for each platform's own retry signalling, not a fixed sleep. Every write goes through the tenant-scoped helpers from Phase 0.

Also fix the Phase 0 limitation: **queues must register dynamically.** Adding a tenant cannot require a worker restart. Either one queue with a tenant field on the job, or a queue registry that reacts to new tenants. Pick one, write it in `docs/decisions.md`.

**Done when** a fake provider can backfill, be interrupted mid-window, resume from its cursor, and produce identical rows to an uninterrupted run.

### 1.2 — Shopify connector

Custom app access token per store, read scopes only: `read_orders`, `read_customers`, `read_products`, `read_inventory`.

Pull: orders with line items, discount allocations, taxes, shipping, refunds; customers with lifetime order count; products and variants; `inventoryItem.unitCost`; `customerJourneySummary` (UTM source, medium, campaign, landing page, referrer, first and last session, days to conversion, order index).

Backfill uses bulk operations. Incremental syncs by `updated_at`. Store the store's timezone and currency on the `stores` row at connect time.

**Done when** 13 months for a real store land in `raw_shopify_*`, a re-run writes zero duplicate rows, and order counts match Shopify Analytics for three sampled months.

### 1.3 — Meta connector

Marketing API. Ad account and campaign level, daily granularity. Fields: spend, impressions, clicks, reach, frequency, actions, action_values, purchase_roas.

Two things that are not optional:

- **Re-pull a trailing 28-day window on every sync.** Meta restates recent days. A single-fetch-and-trust design will silently drift.
- **Store the account's attribution setting alongside the data.** A ROAS figure is meaningless without knowing the window it came from. Note that 7-day view and 28-day view have returned no data since 12 January 2026.

Record the ad account's own timezone and billing currency on the connection.

**Done when** 13 months of daily campaign rows exist, a second sync over the same window updates rather than duplicates, and August spend matches Ads Manager within 2%.

### 1.4 — Google Ads connector

GAQL against campaign level, segmented by date. Fields: `metrics.cost_micros`, impressions, clicks, conversions, conversions_value, campaign type.

`login-customer-id` header on every call, set to the MCC ID, digits only. Client accounts must be linked to the MCC before any call succeeds — that is an onboarding step, not a one-time setup, so surface an unlinked account as a connection health issue rather than a crash.

Build against a test account while the developer token is at Test access. Switch to production accounts when Basic Access is granted, changing configuration only.

**Done when** 13 months of daily campaign rows exist for a real account and cost matches the Google Ads UI within 1%.

### 1.5 — Timezone and currency normalisation

Store timezone and ad account timezone are recorded per connection and will often differ. Choose one canonical reporting timezone per tenant at onboarding and apply it at query time only — never shift timestamps on write.

Daily FX rates from a single source. **Every converted amount stores the rate used and the rate date.** A figure must be reproducible a year from now.

**Done when** a test proves a store in IST with a USD ad account produces the same monthly boundary for both sources, and that a converted amount can be traced back to its rate.

### 1.6 — Backfill orchestration

13 months minimum, more where the platform allows. Resumable, with progress visible per connection. A partially complete backfill is marked as such so nothing downstream treats it as a full history.

Meta note: totals go back 37 months but unique-count and hourly breakdowns are capped at 13 months and frequency at 6. Pull the maximum available on first backfill — our own database becomes the only long history we will ever have.

**Done when** a backfill can be killed halfway and resumed to the same end state, and the admin console shows percentage complete per connection.

### 1.7 — Reconciliation harness

A command that, for a given tenant and month, outputs our totals beside the platform's own figure and the variance: Shopify net sales and order count, Google cost, Meta spend, new customer count.

Variance is expected. Unexplained variance is not. Where a difference is structural — Meta's restatement window, for instance — the harness states the reason rather than just the number.

**Done when** it runs for two real merchants across three months and every variance either sits within tolerance or carries a written explanation.

### 1.8 — Demo tenant seed

Carried over from Phase 0, which correctly deferred it until the data shape existed.

`pnpm seed:demo` generates 18 months for a fictional brand: seasonal revenue curve, a Q4 spike, one underperforming Google campaign, a discount-heavy month, one product with a high refund rate, and a stockout period. Flagged `is_demo` so it never enters billing, alerting or aggregate stats.

**Done when** a fresh clone can run `pnpm seed:demo` and the admin console shows a complete, believable tenant with no external connections.

---

## Test fixtures

Record real API responses as fixtures the first time you see them, for every provider. They are worth more than the code that consumes them.

Anonymise before committing: store names, domains, order IDs, customer names, email addresses, physical addresses. Keep the shapes, quantities and edge cases exactly as they came — partial refunds, multi-currency orders, cancelled line items, zero-spend days.

## Exit criteria

- 13 months of Shopify, Google and Meta data for two real merchants
- Every sync idempotent, proven by re-running a full window
- Backfill resumable, proven by interruption
- Reconciliation harness green, or every variance explained in writing
- Adding a tenant requires no worker restart
- Demo tenant seeds from a clean clone
- `pnpm verify` passes

## Not in this phase

Metric calculations. Findings. Reports. PDF. Merchant portal. Attribution modelling. The pixel.
