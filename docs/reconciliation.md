# Reconciliation against the platform UIs

The harness (`pnpm reconcile <tenant-slug> <YYYY-MM>`) compares our totals
from the raw tables against the numbers each platform's own UI shows, using an
expected-values file you fill in by hand. The logic is fully tested against
the demo tenant (`docs/reconciliation/expected/demo-brand.json`); what remains
— and needs real accounts — is reading the real UI figures and recording them.

Do this for **two real merchants across three months each** (phase exit
criterion), preferring complete months at least 28 days old so Meta's
restatement window has closed.

## 1. Create the expected-values file

Copy `docs/reconciliation/expected/demo-brand.json` to
`docs/reconciliation/expected/<tenant-slug>.json`, set `tenant` and
`currency`, and fill one `months` entry per month using the values below.
Then run:

```bash
pnpm reconcile <tenant-slug> 2026-06
```

## 2. Which screens, which figures

Read every figure **with the date range set to the calendar month in the
tenant's reporting timezone**, and write down the number exactly as displayed.

| Metric key | Where to read it |
|---|---|
| `shopifyNetSales` | Shopify admin → Analytics → Reports → **Sales over time** → the month → the **Net sales** column total. Shopify's net sales = gross − discounts − returns, excluding shipping and taxes — the same definition as `docs/metrics.md`. |
| `shopifyOrders` | Same report, **Orders** total (or Analytics → Orders over time). Shopify counts an order in the day it was created, store timezone. |
| `newCustomers` | Shopify admin → Analytics → Reports → **First-time vs returning customer sales** → count of first-time customers for the month. |
| `metaSpend` | Meta Ads Manager → the ad account → date range set to the month (account timezone) → **Amount spent**, account level (the campaigns-table footer total). |
| `googleCost` | Google Ads → Campaigns → date range set to the month (account timezone) → **Cost** column total across all campaigns. |

## 3. Tolerances

| Metric | Tolerance | Why |
|---|---|---|
| `shopifyOrders` | exact (0%) | Both sides count the same discrete events. |
| `newCustomers` | exact (0%) | Same. |
| `shopifyNetSales` | 0.5% | Rounding across line-level discounts/returns; Shopify Analytics can lag hours behind admin data. |
| `googleCost` | 1% | Phase-1 exit criterion (task 1.4). Cost is stable after a day or two. |
| `metaSpend` | 2% | Phase-1 exit criterion (task 1.3). Meta restates the trailing 28 days. |

## 4. Known structural differences (the harness prints these itself)

- **Meta 28-day restatement** — a month read inside the 28 days after its end
  will move. Re-read after the window closes before treating a variance as real.
- **Google conversion lag** — conversions restate for ~30 days; cost does not
  (materially), so `googleCost` should still reconcile early.
- **Timezone boundary** — when the ad account timezone differs from the
  reporting timezone, up to one day of spend sits across the month boundary
  versus a UI viewed in another timezone. Set the UI's timezone/date range to
  the account's own timezone (the defaults) and compare like for like.
- **Shopify order timestamps** — Shopify Analytics buckets by store timezone.
  The tenant's reporting timezone should equal the store timezone in v1; if
  they differ, expect boundary drift on orders too.

## 5. When a variance is outside tolerance

1. Re-read the UI figure with the date range and timezone double-checked, and
   the month fully outside restatement windows.
2. Re-run the sync for that window (`pnpm worker:sync <tenantId> backfill`
   re-upserts idempotently) and reconcile again — a partial backfill or a
   failed sync day is the most common cause. Check `/connections` for health
   and completeness first.
3. Diff at a finer grain: run the month's days individually (temporary GAQL /
   insights queries) to find *which day* diverges, then compare that day's
   orders/campaign rows against the UI's day view.
4. If the difference is explainable (restatement mid-window, a refund shown in
   a different month by the UI's grouping, a deleted campaign, currency
   rounding), write the explanation into that metric's `explanation` field in
   the expected file — the harness then reports EXPLAINED and passes. An
   explanation must say *why*, not "close enough".
5. If it is not explainable, it is a bug in a connector or in the totals —
   treat it as such before Phase 2 builds on the data.
