# Phase 1 handover — Connectors

Written 2026-09-05, at the end of the autonomous Phase 1 build. Phase 1 code
is complete and tested against synthetic fixtures; **no real merchant account
is connected yet**, and that is the only thing standing between here and the
phase's remaining exit criteria.

---

## What each connector does — and does not yet cover

### Shopify (`services/worker/src/connectors/shopify/`)
Does: custom-app token per store (read scopes only); backfill via bulk
operations (orders by created_at with line items, discount allocations, taxes,
refunds + refund line items, customerJourneySummary; customers with lifetime
order count; products/variants with `inventoryItem.unitCost`); incremental by
updated_at (all three streams, 5-minute overlap watermark); cost-signal
throttle handling; store timezone/currency recorded at connect time; resumable
chunked backfill; idempotent upserts on gid.

Does not yet: inventory levels (scope reserved, nothing pulled); customers
untouched >13 months before connect are absent until they change (noted in
phase-2-notes); line-level cancellations (order-level `cancelledAt` only);
unit-cost history (current cost only — Phase 2 needs a cost-history table).

### Meta (`services/worker/src/connectors/meta/`)
Does: account- and campaign-level daily insights (spend, impressions, clicks,
reach, frequency, actions, action_values, purchase_roas, attribution_setting);
trailing 28-day re-pull on every sync (restatement, proven by test); account
attribution_spec + timezone + billing currency on the connection; unique
metrics only requested inside their 13-month cap; BUC-header rate limiting;
37-month backfill window.

Does not yet: ad-set/ad-level breakdowns; creative metadata; hourly
breakdowns (deliberately — capped and out of scope).

### Google Ads (`services/worker/src/connectors/google-ads/`)
Does: campaign-level daily GAQL via REST searchStream (cost_micros,
impressions, clicks, conversions, conversions_value, channel type);
login-customer-id (MCC, digits only) on every call; unlinked account →
connection `broken` with the linking instruction, never a crash; OAuth
refresh-token flow with cached access tokens; trailing 30-day re-pull;
37-month window. Built for a Test-access developer token; the production
switch is configuration only (docs/decisions.md, task 1.4 entry).

Does not yet: ad-group/keyword level; budget/bid data; anything requiring
Basic Access approval.

### Shared
Resumable cursor engine (interrupt/resume proven identical to uninterrupted),
single dynamic sync queue (new tenant needs no restart, proven), nightly
scheduler + FX pull, per-connection health and backfill % in the admin
console, FX rates (Frankfurter/ECB) with traceable conversions, demo tenant
seed, reconciliation harness.

---

## Synthetic fixtures to replace with real recordings

Every fixture below was hand-authored from published API docs (filename prefix
`synthetic-`). When each platform's first real account is connected, record
the real responses, anonymise (store names, domains, order ids, customer
names, emails, addresses), keep the edge cases, and replace:

| Fixture | Replace when |
|---|---|
| `services/worker/test/fixtures/shopify/synthetic-bulk-orders.jsonl` | first real store — keep: partial refund, multi-currency, cancelled order, shipping-only refund, discount allocations |
| `services/worker/test/fixtures/shopify/synthetic-bulk-customers.jsonl` | first real store |
| `services/worker/test/fixtures/shopify/synthetic-bulk-products.jsonl` | first real store — keep one variant with missing unitCost |
| `services/worker/test/fixtures/shopify/synthetic-orders-incremental-page1.json` / `-page2.json` | first real store — keep the updated-order-with-new-refund shape |
| `services/worker/test/fixtures/meta/synthetic-account-info.json` | first real ad account |
| `services/worker/test/fixtures/meta/synthetic-insights-campaign-page1.json` / `-page2.json` | first real ad account — keep a zero-spend day |
| `services/worker/test/fixtures/meta/synthetic-insights-account.json` | first real ad account |
| `services/worker/test/fixtures/meta/synthetic-insights-campaign-restated.json` | record the same day twice ≥1 day apart to capture a real restatement |
| `services/worker/test/fixtures/google-ads/synthetic-searchstream-campaigns.json` | first linked account — keep a zero-cost day |
| `services/worker/test/fixtures/google-ads/synthetic-customer-info.json` | first linked account |
| `services/worker/test/fixtures/google-ads/synthetic-unlinked-error.json` | trivially recordable: query any unlinked account once |
| `services/worker/test/fixtures/fx/synthetic-frankfurter-timeseries.json` | any time — one real `curl` of the timeseries endpoint |

---

## Connecting real accounts — in this order

### 0. Prerequisites (one-time)
- Deploy the marketing site (docs/deploy.md) — the Google developer-token
  application needs `getgrossline.com` live.
- Fill `.env`: `MASTER_KEY` (already set locally), `SHOPIFY_API_VERSION=2026-07`,
  `META_API_VERSION=v21.0`, and the Google trio
  (`GOOGLE_ADS_DEVELOPER_TOKEN`, `GOOGLE_ADS_CLIENT_ID`,
  `GOOGLE_ADS_CLIENT_SECRET`) once you have them.
- Create the tenant: currently via `createTenant` (a tsx one-liner or
  `pnpm db:studio`) — slug, reporting currency, reporting timezone. Set
  status `active` so the nightly scheduler picks it up.

### 1. Shopify (no approvals needed — unblocks everything)
1. In the merchant's Shopify admin: Settings → Apps and sales channels →
   Develop apps → Create app → Configure Admin API scopes: `read_orders`,
   `read_customers`, `read_products`, `read_inventory` only → Install →
   reveal the Admin API access token (`shpat_…`).
2. `SHOPIFY_STORE_TOKEN=shpat_… pnpm connect:shopify <tenantId> <store>.myshopify.com`
   (verifies the token, records store timezone/currency, encrypts the token).
3. Start the worker (`pnpm dev`) and run `pnpm worker:sync <tenantId> backfill`.
   Watch progress at `localhost:3000/connections`.
4. Record real fixtures from the first responses; replace the synthetic ones.
5. Reconcile three months against Shopify Analytics (docs/reconciliation.md).

### 2. Meta
1. Business settings → System user (admin of the ad account's Business) →
   generate a long-lived token with `ads_read` for the ad account.
2. `META_ACCOUNT_TOKEN=EAA… pnpm connect:meta <tenantId> act_<accountId>`
   (records timezone, billing currency, attribution_spec).
3. `pnpm worker:sync <tenantId> backfill` — 37 months of dailies.
4. Replace synthetic fixtures; reconcile August (or any closed month ≥28 days
   old) against Ads Manager within 2%.

### 3. Google Ads (last — token approval gates it)
1. While the developer token is at **Test access**: create a test MCC +
   test account, set `GOOGLE_ADS_LOGIN_CUSTOMER_ID` to the test MCC, generate
   a refresh token for the OAuth client, and
   `GOOGLE_ADS_REFRESH_TOKEN=1//… pnpm connect:google <tenantId> <customerId>`
   to prove the pipe end-to-end.
2. Apply for **Basic Access** (needs getgrossline.com live). When granted:
   point `GOOGLE_ADS_LOGIN_CUSTOMER_ID` at the production MCC, **link each
   client account to the MCC** (MCC → Accounts → + → Link existing account;
   merchant accepts), then `pnpm connect:google` per account. An unlinked
   account shows as `broken` on /connections with the exact instruction — 
   linking is per-account onboarding, not setup.
3. Backfill, replace fixtures, reconcile cost within 1%.

### 4. After all three
- `pnpm fx:pull 500` once, so conversion history exists before Phase 2.
- Reconcile two merchants × three months and record the expected files under
  `docs/reconciliation/expected/`.

---

## Exit criteria: met vs waiting on real accounts

| Criterion | Status |
|---|---|
| Every sync idempotent, proven by re-running a full window | ✅ proven by test, all three connectors + seed |
| Backfill resumable, proven by interruption | ✅ proven by test (kill mid-window, resume, identical rows) |
| Adding a tenant requires no worker restart | ✅ proven by test |
| Demo tenant seeds from a clean clone | ✅ verified on a fresh GitHub clone |
| `pnpm verify` passes | ✅ locally, in CI, and from a clean clone |
| Reconciliation harness green, or every variance explained | ✅ harness logic green against the demo tenant; ⏳ real-merchant runs need accounts |
| 13 months of Shopify, Google and Meta data for two real merchants | ⏳ needs real accounts — connectors ready, switch is config only |
