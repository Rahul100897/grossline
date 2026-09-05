# Shopify fixtures

Two kinds of file:

- **`recorded-`** — real API responses from a development store
  (2026-09-05), anonymised: store name/vendor replaced, all gids remapped to
  sequential fake ids. No PII was ever fetched (protected customer data).
  Shapes, quantities and quirks kept exactly (e.g. `amountSpent: "0.0"`,
  empty `productType`, `unitCost: null`).
- **`synthetic-`** — hand-authored from Shopify's published Admin GraphQL API
  docs (2026-07). Still standing in ONLY where the recording store had no
  data: **orders** (the store has zero orders — `numberOfOrders` on its
  customers shows they existed once and were deleted). Replace with real
  recordings when a store with real orders (and its refund/multi-currency
  edge cases) is connected.

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

**Live-API corrections applied 2026-09-05** (first contact with
rahul-developer-store): `momentsCount` is a `Count` object; bulk JSONL never
contains `RefundLineItem` child lines (enrichment happens per order after the
bulk download). Real anonymised recordings are still pending — blocked on the
app version being released with scopes (see docs/decisions.md).
