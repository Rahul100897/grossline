# Notes for Phase 2 (metric layer)

Temptations resisted during Phase 1, parked here per the "do not compute any
metric" rule.

- **Reconciliation totals ≠ metric layer.** `services/worker/src/reconcile.ts`
  computes reference totals (net sales, order count, new customers, spend,
  cost) in TypeScript over raw payloads, for comparison against platform UIs
  only. Phase 2 should implement the real metric layer as raw SQL into
  `metrics_*` tables per CLAUDE.md, with golden-file tests — and can reuse the
  reconciliation harness to cross-check itself.
- **Demo campaign ROAS**: the seed bakes in `pmax-underperformer` (ROAS < 1)
  and `search-brand` (ROAS > 3). The seed test asserts these with an ad-hoc
  value/spend division — that arithmetic is NOT a metric definition; Phase 2's
  platform-ROAS metric must come from `docs/metrics.md` (platform-reported
  figure, recorded for reference only).
- **FX machinery is built but unused.** `fx_rates` + `convertMinorUnits`
  (rate + rateDate traceability) are tested and waiting; nothing converts
  amounts yet. Phase 2's blended metrics ("converted at the daily rate") plug
  in here. Run `pnpm fx:pull 500` once before computing over history.
- **COGS**: variant `unitCost` is captured (current value only). metrics.md
  wants costs *effective on the order date* — Phase 2 needs a cost-history
  table (effective-from dates) fed at sync time, since Shopify only exposes
  the current cost.
- **`raw_shopify_customers` completeness**: customers untouched for >13 months
  before connect are absent until their next update. If Phase 2's new/returning
  split needs full customer history, widen the customers backfill window
  (customers are cheap) or rely on `customerJourneySummary.customerOrderIndex`.
- **metrics.md open questions** (multi-store dedupe, subscriptions, gift
  cards, shipping-only refunds) are still open — decide before Phase 2 ends.
