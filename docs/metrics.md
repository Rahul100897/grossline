# Metric definitions

The single source of truth. If code disagrees with this file, the code is wrong.

Every change to this file needs a note in the changelog at the bottom and a recompute of affected periods.

---

## Conventions

- All amounts are integer minor units with an explicit currency code.
- Converted amounts store the FX rate used and the rate date.
- A "period" is a calendar month in the tenant's **reporting timezone**, which is chosen at onboarding and stated on every report.
- Comparisons are against the immediately preceding period unless stated.

---

## Revenue

**Gross sales** — sum of line item price × quantity, before discounts, returns, taxes and shipping.

**Discounts** — total discount allocated to line items, including order-level discounts allocated proportionally. Positive number, subtracted.

**Returns** — refunded line item value. **Recognised on the original order date, not the refund date.** This is deliberate: it keeps a month's margin honest rather than pushing losses into a later period.

**Net sales** — gross sales − discounts − returns. Excludes shipping charged and taxes collected.

**Shipping revenue** — shipping charged to the customer. Reported separately, not part of net sales.

**Taxes collected** — reported separately. Never revenue.

**Cancelled orders** — excluded from all revenue metrics entirely, not treated as returns.

**AOV** — net sales ÷ order count.

**Order count** — orders with at least one non-cancelled line item, in the period, by the order's creation timestamp in reporting timezone.

---

## Cost and margin

**COGS** — unit cost × quantity, using the cost **effective on the order date**. Costs carry effective-from dates so historical margins never change when a new cost is uploaded. If a SKU has no cost for that date, it is counted as missing, not as zero, and surfaced as a data issue.

**Gross profit** — net sales − COGS.
**Gross margin %** — gross profit ÷ net sales.

**Payment fees** — merchant-supplied percentage and fixed fee per order.
**Shipping cost** — merchant-supplied, per order or monthly total allocated per order.
**Fulfilment cost** — merchant-supplied, per order.
**Packaging cost** — merchant-supplied, per order.

All merchant-supplied cost inputs carry **effective-from dates** (like COGS): a
later change never alters a historical month. Missing inputs are missing, not
zero, and surface as reduced completeness.

**Monthly revenue target / monthly ad spend target** — merchant-supplied,
effective-from dated. Not metrics; reference lines for pacing (Phase 2.6).

**Contribution margin after ad spend** — net sales − COGS − ad spend.
**Full contribution margin** — net sales − COGS − ad spend − payment fees − shipping cost − fulfilment cost.

**Break-even ROAS** — 1 ÷ contribution margin rate, where contribution margin rate = (net sales − COGS − fees) ÷ net sales.

---

## Customers

**New customer** — a customer whose order in this period is their first ever order with this store, by the store's own customer record. Not by email matching across stores.

**Returning customer** — any customer with a prior order.

**New customer revenue** — net sales attributable to orders placed by new customers.

**Repeat rate, N days** — of customers whose first order fell in the period, the share who placed a second order within N days. Cohort-based, so the 90-day figure for a month is only final 90 days after that month ends. Mark provisional until then.

**Time to second order** — median days between first and second order, for customers who placed a second.

---

## Ad platforms

**Ad spend** — platform-reported cost. Google `metrics.cost_micros` ÷ 1,000,000. Meta `spend`. Always in the ad account's billing currency, converted at the daily rate.

**Platform-reported conversions** — what the platform claims. Always labelled as platform-reported. **Never summed across platforms** — they overlap.

**Platform ROAS** — the platform's own figure. Meta on 7-day click. Google on last click. Recorded for reference only, never used in a blended calculation.

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

---

## Channel attribution

Taken from Shopify's `customerJourneySummary` on the order: UTM source, medium, campaign, landing page, referrer, first and last session, days to conversion.

**Store-recorded orders by channel** — orders whose first-touch UTM source matches the channel.

**Claim gap** — (platform-reported conversions − store-recorded orders for that channel) ÷ platform-reported conversions.

This is a measurement signal, not a correction. We do not claim either number is right. We report both and show the divergence. Never present the claim gap as a corrected conversion count.

---

## Open questions

Decide before Phase 2 ends. Do not guess in code.

- [ ] Multi-store merchants: are new customers deduplicated across their stores, or counted per store? Currently per store.
- [ ] Subscription orders: separate from one-time in revenue reporting, or combined?
- [ ] Gift card sales: excluded from net sales at purchase and counted at redemption, or the reverse?
- [ ] Partial refunds where only shipping is refunded — currently reduces shipping revenue, not net sales. Confirm.

---

## Changelog

| Date | Change | Periods recomputed |
|---|---|---|
| — | Initial version | — |
| 2026-09-05 | Added packaging cost and monthly revenue/spend targets to merchant-supplied inputs; documented effective-from dating for all cost inputs (Phase 2 tasks 2.1/2.2) | none — no metrics computed yet |
