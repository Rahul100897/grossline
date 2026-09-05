# Shopify fixtures

Two kinds of file:

- **`recorded-`** — real API responses from a development store
  (2026-09-05), anonymised: store name/vendor replaced, all gids remapped to
  sequential fake ids. No PII was ever fetched (protected customer data).
  Shapes, quantities and quirks kept exactly (e.g. `amountSpent: "0.0"`,
  empty `productType`, `unitCost: null`).
- **`synthetic-`** — hand-authored from Shopify's published Admin GraphQL API
  docs (2026-07). Retained ONLY for edge cases the recording store cannot
  produce (multi-currency presentment, shipping-only refunds) and for the
  incremental update-in-place behaviour pages. Everything else is recorded.

All names, domains and IDs in both kinds are fictional after anonymisation.

| File | What it covers |
|---|---|
| `synthetic-bulk-orders.jsonl` | Bulk-op JSONL: plain order, order-level discount, partial refund, multi-currency (EUR presentment), cancelled order, shipping-only refund; line items and refund line items as flattened `__parentId` children |
| `synthetic-bulk-customers.jsonl` | Customers with lifetime order counts |
| `synthetic-bulk-products.jsonl` | Products with variants (flattened) incl. `inventoryItem.unitCost`, one variant with missing cost |
| `synthetic-orders-incremental-page1.json` | Paginated incremental orders response, page 1 (updated existing order — refund added) |
| `synthetic-orders-incremental-page2.json` | Page 2 (a new order), `hasNextPage: false` |
| `synthetic-order-refunds.json` | Per-order refund enrichment responses (bulk ops cannot nest `refundLineItems` in the `refunds` list — live-API constraint, 2026-09-05) |
| `recorded-bulk-customers.jsonl` | REAL bulk customers export (anonymised, no PII fields) |
| `recorded-bulk-products.jsonl` | REAL bulk products export with `__parentId` variant children (anonymised) |
| `recorded-orders-incremental-empty.json` | REAL empty incremental orders page |
| `recorded-bulk-orders.jsonl` | REAL bulk orders export (anonymised): 10 seeded test orders — discount codes (percent + fixed) with allocations, partial/full refunds, a cancellation with auto-refund, mixed quantities, repeat customer, shipping charged vs free, tax lines |
| `recorded-order-refunds.json` | REAL per-order refund enrichment responses for the three refunded orders |
| `recorded-orders-incremental.json` | REAL incremental orders page containing all ten orders |

The seeded orders were created by `scripts/seed-dev-orders.ts` (dev-only,
hard-guarded to rahul-developer-store). Note: Shopify does not allow setting
`createdAt` via orderCreate — the seeded orders carry today's `createdAt` and
a 45-day spread in `processedAt`.

**Live-API corrections applied 2026-09-05** (first contact with
rahul-developer-store): `momentsCount` is a `Count` object; bulk JSONL never
contains `RefundLineItem` child lines (enrichment happens per order after the
bulk download). Real anonymised recordings are still pending — blocked on the
app version being released with scopes (see docs/decisions.md).
