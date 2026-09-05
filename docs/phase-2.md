# Phase 2 — Metric layer

Goal: every metric in `docs/metrics.md` computed for any tenant and any month, from raw data, recomputable with one command, with a golden-file test each.

No findings. No reports. No PDF. Numbers only, and correct.

**Prerequisite:** at least one real Shopify store connected, backfilled and reconciled. Metrics built on synthetic fixtures alone will look right and be wrong. If real data is not connected yet, build 2.1 and 2.2 and stop.

---

## Principles for this phase

**Raw is never touched.** Metrics read from `raw_*` and write to `metrics_*`. A definition change means recompute, never re-pull.

**Recompute is cheap and total.** `pnpm metrics:compute <tenant> <period>` and `pnpm metrics:recompute <tenant> --from <period>` must be safe to run at any time, any number of times.

**The reconciliation harness stays independent.** Task 1.7's reference math must NOT be refactored to call the metric layer. Two independent implementations that agree is a real check. One implementation checking itself is theatre.

**Nothing is computed from a definition that isn't written down.** If `docs/metrics.md` doesn't define it, it doesn't get built.

---

## Tasks

### 2.1 — COGS with effective-from dates

The open question parked in Phase 1. Costs carry effective-from dates so a new upload never changes a historical month's margin.

- `product_costs` table: tenant_id, sku or variant_id, unit_cost minor units, currency, effective_from, source (`shopify | upload`), uploaded_at
- Cost resolution for an order line = the cost row whose `effective_from` is the latest date on or before the order date
- Missing cost is **missing**, never zero. Surfaced as a data issue with the affected SKU count and revenue at stake
- CSV upload with column validation and a per-row error report
- `inventoryItem.unitCost` from Shopify used as the initial source where the merchant maintains it

**Done when** a test uploads costs twice with different effective dates and proves a March order still resolves the March cost after a June upload.

### 2.2 — Merchant cost inputs

Payment fee percentage and fixed fee, shipping cost, fulfilment cost, packaging cost, monthly revenue and spend targets. All merchant-supplied, all with effective-from dates for the same reason as COGS.

**Done when** the admin console can set them per tenant and a test proves historical months are unaffected by a later change.

### 2.3 — Revenue and order metrics

Gross sales, discounts, returns (recognised on the original order date), net sales, shipping revenue, taxes collected, order count, AOV, units per order, refund rate, cancelled rate. Daily series and monthly aggregate. Cancelled orders excluded entirely.

**Done when** every metric in the Revenue section of `docs/metrics.md` computes, each with a golden-file test, and the monthly totals match the 1.7 reference math exactly.

### 2.4 — Customer metrics

New vs returning by the store's own customer record, not email matching. New customer count and revenue, new customer revenue share, repeat rate at 30/60/90 days, time to second order, order frequency distribution, acquisition cohorts with cumulative revenue per customer.

Cohort figures are **provisional until the window closes**. A 90-day repeat rate for last month is not final. Mark it, and make the UI able to show it as provisional later.

**Done when** cohort curves compute for the demo tenant and match hand-calculated values in the golden file.

### 2.5 — Margin and contribution

Gross profit and margin %, contribution margin after ad spend, full contribution margin after fees and shipping and fulfilment, break-even ROAS from the actual margin structure.

Where cost data is missing, the metric is returned with a completeness flag rather than a silently wrong number. A margin computed over 60% of SKUs is not a margin.

**Done when** the demo tenant produces a full waterfall — gross sales through to contribution — that adds up, with a completeness percentage attached.

### 2.6 — Ad platform metrics

Per platform and per campaign: spend, impressions, clicks, CPM, CPC, CTR, platform-reported conversions and conversion value, platform ROAS. All labelled platform-reported. Never summed across platforms.

Budget pacing: spend to date against the monthly target, with projected month-end at the current run rate.

**Done when** platform totals match the raw tables exactly and a test proves platform ROAS is never used in any blended calculation.

### 2.7 — Blended metrics

MER, aMER, blended CAC, first-order contribution against CAC, ad spend as a percentage of net sales, spend share versus revenue share by platform.

These are the product. They get the most careful tests.

**Done when** each has a golden-file test built from hand-calculated values, not from the implementation's own output.

### 2.8 — Channel mix and claim gap

Orders by first-touch and last-touch UTM source, medium and campaign from `customerJourneySummary`. Landing page performance. Days to conversion. Untagged traffic isolated as direct.

Claim gap = (platform-reported conversions − store-recorded orders for that channel) ÷ platform-reported conversions.

Report both numbers and the divergence. **Never present the gap as a corrected conversion count** — we are not claiming either number is right.

**Done when** the demo tenant shows a claim gap consistent with its seeded narrative, and a test asserts the gap is never used to adjust any revenue figure.

### 2.9 — Comparison engine

Month over month, previous period, year over year, rolling 7/28/90. One implementation used by every metric, not per-metric comparison logic.

Year-over-year must degrade gracefully where history doesn't exist yet — absent, not zero, and never a misleading percentage.

**Done when** any metric can be requested with any comparison and missing history returns an explicit absent value.

### 2.10 — Compute pipeline and test harness

`metrics:compute` for one period, `metrics:recompute` for a range, wired into the nightly job after sync. A `metric_runs` table recording what was computed, when, and from which raw watermark.

Golden-file harness: fixture in, expected values committed, diff shown in the PR when a definition changes. This is the mechanism that makes a definition change visible rather than silent.

**Done when** changing one definition produces a readable diff across every affected golden file.

### 2.11 — Close the open questions

The four questions at the bottom of `docs/metrics.md` must be decided and written up, not left open:

- Multi-store new customer deduplication
- Subscription vs one-time revenue treatment
- Gift card timing
- Shipping-only partial refunds

Each gets a decision, a rationale and a changelog entry.

**Done when** the open questions section is empty and the changelog has four entries.

---

## Exit criteria

- Every metric in `docs/metrics.md` computes for any tenant and any month
- Golden-file test per metric, values hand-calculated not implementation-derived
- Metric layer and the 1.7 reference math agree independently
- Recompute from raw is a single command and is idempotent
- Missing cost data produces a completeness flag, never a wrong number
- Open questions closed
- `pnpm verify` green

## Not in this phase

Findings engine. Reports. PDF. Merchant portal. Anything with an opinion about what the numbers mean.
