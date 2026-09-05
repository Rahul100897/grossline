# Metric definitions

The single source of truth. If code disagrees with this file, the code is wrong.

Every change to this file needs a note in the changelog at the bottom and a recompute of affected periods.

---

## Conventions

- All amounts are integer minor units with an explicit currency code.
- Converted amounts store the FX rate used and the rate date.
- A "period" is a calendar month in the tenant's **reporting timezone**, which is chosen at onboarding and stated on every report.
- Comparisons are against the immediately preceding period unless stated.
- **The order date is Shopify's `processedAt`, everywhere.** Shopify Analytics
  keys on `processedAt`, and reconciliation compares against Analytics —
  keying on `createdAt` would create permanent structural variance on
  backdated, imported, draft-converted and POS orders. Every rule that says
  "order date" (period assignment, returns recognition, cost resolution,
  cohort membership) means the order's `processedAt` in the reporting
  timezone.

---

## Revenue

**Gross sales** — sum of line item price × quantity, before discounts, returns, taxes and shipping.

**Discounts** — total discount allocated to line items, including order-level discounts allocated proportionally. Positive number, subtracted.

**Returns** — refunded line item value. **Recognised on the original order date (the order's `processedAt`), not the refund date.** This is deliberate: it keeps a month's margin honest rather than pushing losses into a later period.

**Net sales** — gross sales − discounts − returns. Excludes shipping charged and taxes collected.

**Shipping revenue** — shipping charged to the customer, minus shipping-only
refund amounts. Reported separately, not part of net sales.

**Taxes collected** — reported separately. Never revenue.

**Cancelled orders** — excluded from all revenue metrics entirely, not treated as returns.

**AOV** — net sales ÷ order count.

**Order count** — orders with at least one non-cancelled line item, in the period, by the order's `processedAt` timestamp in reporting timezone.

**Units per order** — units sold (sum of non-cancelled orders' line quantities, gift-card lines excluded) ÷ order count.

**Refund rate** — orders with at least one refund line item ÷ order count, both by the order's period. Shipping-only refunds do not count.

**Cancelled rate** — cancelled orders ÷ (order count + cancelled orders), by the order's period. The denominator adds cancellations back because cancelled orders are excluded from order count.

**Gift cards** — gift-card line items are excluded from gross sales, net sales and units at purchase (a gift card sale is a liability, and Shopify Analytics excludes it); nothing is recognised at redemption, which is a payment method. Matches Shopify Analytics, which reconciliation compares against.

**Multi-store merchants** — new/returning customers are counted **per store**, by the store's own customer record. Cross-store deduplication would require email matching, which these definitions explicitly reject.

**Subscription orders** — combined with one-time revenue in v1. No subscription platform is connected, so any split would be inferred, not sourced. Revisit when a subscriptions connector exists.

---

## Cost and margin

**COGS** — unit cost × **net units** (ordered minus refunded, consistent with returns recognition), using the cost **effective on the order date**. Costs carry effective-from dates so historical margins never change when a new cost is uploaded. If a SKU has no cost for that date, it is counted as missing, not as zero, and surfaced as a data issue; every margin metric carries a completeness rate.

**Gross profit** — net sales − COGS.
**Gross margin %** — gross profit ÷ net sales.

**Payment fees** — merchant-supplied percentage and fixed fee per order. The percentage applies to the order's total charge (what the processor sees: items + shipping + tax). Fees are not returned on refunds.
**Shipping cost** — merchant-supplied, per order or monthly total allocated per order.
**Fulfilment cost** — merchant-supplied, per order.
**Packaging cost** — merchant-supplied, per order.

All merchant-supplied cost inputs carry **effective-from dates** (like COGS): a
later change never alters a historical month. Missing inputs are missing, not
zero, and surface as reduced completeness.

**Monthly revenue target / monthly ad spend target** — merchant-supplied,
effective-from dated. Not metrics; reference lines for pacing (Phase 2.6).

**Contribution margin after ad spend** — net sales − COGS − ad spend.
**Full contribution margin** — net sales − COGS − ad spend − payment fees − shipping cost − fulfilment cost − packaging cost. Only computed when the merchant has supplied every cost input for the period — missing inputs are missing, never zero.

**Break-even ROAS** — 1 ÷ contribution margin rate, where contribution margin rate = (net sales − COGS − fees) ÷ net sales and "fees" is all merchant-supplied per-order costs (payment, shipping, fulfilment, packaging) — i.e. the margin before ad spend.

---

## Customers

**New customer** — a customer whose order in this period is their first ever order with this store, by the store's own customer record. Not by email matching across stores.

**Returning customer** — any customer with a prior order.

**New customer revenue** — net sales attributable to orders placed by new customers.

**Repeat rate, N days** — of customers whose first order fell in the period, the share who placed a second order within N days. Cohort-based, so the 90-day figure for a month is only final 90 days after that month ends. Mark provisional until then.

**Time to second order** — median days between first and second order, for customers of the period's acquisition cohort who placed a second. Provisional while the cohort's 90-day window is open.

**Order frequency distribution** — of customers with at least one non-cancelled order on or before the period end, the count by lifetime order count to date, bucketed 1 / 2 / 3 / 4+.

**Acquisition cohort revenue per customer** — for the cohort of customers whose first-ever order falls in the period: cumulative net sales from those customers through the end of period + k months, divided by cohort size. Provisional until the k-month window closes.

**Cohort membership caveat** — a customer whose earliest order in our data carries a Shopify `customerOrderIndex` greater than 1 predates our data (e.g. the 60-day order window without `read_all_orders`) and is never counted as new.

---

## Ad platforms

**Ad spend** — platform-reported cost. Google `metrics.cost_micros` ÷ 1,000,000. Meta `spend`. Always in the ad account's billing currency, converted at the daily rate.

**Platform-reported conversions** — what the platform claims. Always labelled as platform-reported. **Never summed across platforms** — they overlap.

**Platform ROAS** — platform-reported conversion value ÷ platform-reported spend, both from the platform's own rows (Meta on its account attribution setting, Google on last click). Recorded for reference only, never used in a blended calculation.

**CPM / CPC / CTR** — spend ÷ impressions × 1000, spend ÷ clicks, clicks ÷ impressions — per platform and per campaign, from platform-reported rows.

**Platform totals** — taken from the platform's own account-level rows where it publishes them (Meta); the sum of campaign rows where the platform's total is that sum (Google). Stored totals must match the raw tables exactly.

**Budget pacing** — spend month-to-date against the merchant's monthly spend target, with projected month-end spend at the current daily run rate. For a closed month the projection is the actual.

Note: since 12 January 2026, Meta no longer returns 7-day view or 28-day view attribution windows. Meta insights totals are available for 37 months; unique-count and hourly breakdowns for 13 months; frequency breakdowns for 6 months. Store everything on first pull — our own database is the only long history we will have.

Meta restates recent days. Re-pull a trailing 28-day window on every sync. Anything inside 7 days is marked provisional in the UI and on reports.

---

## Blended

**Total ad spend** — Google + Meta, converted to reporting currency.

**MER** — net sales ÷ total ad spend.

**aMER** — new customer revenue ÷ total ad spend.

**Blended CAC** — total ad spend ÷ new customer count.

**First-order contribution** — (new customer revenue − COGS on those orders − fees) ÷ new customer count. Compared against blended CAC to answer whether acquisition pays back on the first order.

**Ad spend as % of net sales** — total ad spend ÷ net sales.

**Spend share / revenue share by platform** — a platform's share of total ad spend, beside its share of net sales from store-recorded first-touch orders (UTM source mapped to the platform). The revenue side is store-recorded, never platform-claimed.

**Zero denominators** — blended ratios (MER, aMER, blended CAC) are absent when their denominator is zero, never reported as zero.

---

## Channel attribution

Taken from Shopify's `customerJourneySummary` on the order: UTM source, medium, campaign, landing page, referrer, first and last session, days to conversion.

**Store-recorded orders by channel** — orders whose first-touch UTM source matches the channel.

**Claim gap** — (platform-reported conversions − store-recorded orders for that channel) ÷ platform-reported conversions.

This is a measurement signal, not a correction. We do not claim either number is right. We report both and show the divergence. Never present the claim gap as a corrected conversion count.

---

## Open questions

None. The four Phase 1 questions were decided 2026-09-05 — see the Revenue
section (gift cards, shipping-only refunds, multi-store, subscriptions) and
the changelog.

---

## Changelog

| Date | Change | Periods recomputed |
|---|---|---|
| — | Initial version | — |
| 2026-09-05 | Added packaging cost and monthly revenue/spend targets to merchant-supplied inputs; documented effective-from dating for all cost inputs (Phase 2 tasks 2.1/2.2) | none — no metrics computed yet |
| 2026-09-05 | **Order date is `processedAt` everywhere** (period assignment, returns recognition, cost resolution, cohorts). Rationale: Shopify Analytics keys on processedAt; createdAt would create permanent structural variance on backdated/imported/draft-converted/POS orders. Decided by Rahul. | none — no metrics computed yet |
| 2026-09-05 | Defined units per order, refund rate, cancelled rate (required by Phase 2 task 2.3) | none |
| 2026-09-05 | Open question closed — **gift cards**: gift-card lines excluded from gross/net/units at purchase, nothing at redemption. Matches Shopify Analytics (the reconciliation target). | none |
| 2026-09-05 | Open question closed — **shipping-only refunds**: reduce shipping revenue, never net sales (confirmed existing behaviour). | none |
| 2026-09-05 | Open question closed — **multi-store**: new customers counted per store, by the store's own customer record; cross-store dedupe would be email matching, which we reject. | none |
| 2026-09-05 | Open question closed — **subscriptions**: combined with one-time revenue in v1; no subscription source is connected, a split would be inferred not sourced. Revisit with a subscriptions connector. | none |
| 2026-09-06 | Defined order frequency distribution and acquisition-cohort revenue per customer; scoped time-to-second-order to the period cohort; documented the customerOrderIndex cohort caveat (task 2.4) | none — first computation |
| 2026-09-06 | COGS clarified to net units (ordered − refunded); payment fee base = order total charge; full contribution margin now subtracts packaging cost; break-even "fees" = all merchant per-order costs (task 2.5) | none — first computation |
| 2026-09-06 | Defined CPM/CPC/CTR, platform-total sourcing, budget pacing; platform ROAS clarified as value÷spend from platform rows (task 2.6) | none — first computation |
| 2026-09-06 | Defined spend share vs revenue share by platform (store-recorded first touch) and the zero-denominator rule for blended ratios (task 2.7) | none — first computation |
