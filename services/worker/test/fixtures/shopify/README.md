# Shopify fixtures

**Every file prefixed `synthetic-` is hand-authored from Shopify's published
Admin GraphQL API docs (2026-07), not recorded from a real store.** Replace
each with a real recorded response (anonymised) once a live store is
connected, keeping the same edge cases. Tracked in
`docs/phase-1-handover.md`.

All names, domains, emails and IDs are fictional.

| File | What it covers |
|---|---|
| `synthetic-bulk-orders.jsonl` | Bulk-op JSONL: plain order, order-level discount, partial refund, multi-currency (EUR presentment), cancelled order, shipping-only refund; line items and refund line items as flattened `__parentId` children |
| `synthetic-bulk-customers.jsonl` | Customers with lifetime order counts |
| `synthetic-bulk-products.jsonl` | Products with variants (flattened) incl. `inventoryItem.unitCost`, one variant with missing cost |
| `synthetic-orders-incremental-page1.json` | Paginated incremental orders response, page 1 (updated existing order — refund added) |
| `synthetic-orders-incremental-page2.json` | Page 2 (a new order), `hasNextPage: false` |
