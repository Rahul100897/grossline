// GraphQL field selections for everything Phase 1 pulls from Shopify.
// Money always as MoneyBag (shop + presentment) so multi-currency orders keep
// both sides; customerJourneySummary feeds Phase 2 channel attribution.

const MONEY_BAG = `{
  shopMoney { amount currencyCode }
  presentmentMoney { amount currencyCode }
}`;

const VISIT_FIELDS = `{
  id
  source
  sourceType
  referrerUrl
  landingPage
  occurredAt
  utmParameters { source medium campaign content term }
}`;

export const ORDER_FIELDS = `
  id
  name
  createdAt
  updatedAt
  processedAt
  cancelledAt
  cancelReason
  closedAt
  test
  currencyCode
  presentmentCurrencyCode
  taxesIncluded
  customer { id numberOfOrders }
  totalPriceSet ${MONEY_BAG}
  subtotalPriceSet ${MONEY_BAG}
  totalDiscountsSet ${MONEY_BAG}
  totalTaxSet ${MONEY_BAG}
  totalShippingPriceSet ${MONEY_BAG}
  totalRefundedSet ${MONEY_BAG}
  customerJourneySummary {
    daysToConversion
    customerOrderIndex
    momentsCount { count precision }
    firstVisit ${VISIT_FIELDS}
    lastVisit ${VISIT_FIELDS}
  }
`;

const REFUND_FIELDS = `
  id
  createdAt
  note
  totalRefundedSet ${MONEY_BAG}
`;

export const LINE_ITEM_FIELDS = `
  id
  title
  quantity
  currentQuantity
  isGiftCard
  sku
  vendor
  product { id }
  variant { id }
  originalUnitPriceSet ${MONEY_BAG}
  discountedUnitPriceSet ${MONEY_BAG}
  totalDiscountSet ${MONEY_BAG}
  discountAllocations {
    allocatedAmountSet ${MONEY_BAG}
  }
  taxLines {
    rate
    priceSet ${MONEY_BAG}
  }
`;

export const REFUND_LINE_ITEM_FIELDS = `
  id
  quantity
  restockType
  lineItem { id }
  subtotalSet ${MONEY_BAG}
  totalTaxSet ${MONEY_BAG}
`;

// No PII on purpose: email/displayName are protected customer data needing
// separate Shopify approval, and no metric in docs/metrics.md uses them
// ("new customer" keys on the store's own customer record, never email).
export const CUSTOMER_FIELDS = `
  id
  createdAt
  updatedAt
  numberOfOrders
  amountSpent { amount currencyCode }
`;

export const PRODUCT_FIELDS = `
  id
  title
  status
  productType
  vendor
  createdAt
  updatedAt
`;

export const VARIANT_FIELDS = `
  id
  title
  sku
  price
  compareAtPrice
  createdAt
  updatedAt
  inventoryItem {
    id
    unitCost { amount currencyCode }
  }
`;

const iso = (d: Date) => d.toISOString();

/**
 * Backfill: orders by created_at so a window's coverage is complete.
 *
 * Live-API constraint (2026-09-05): bulk operations reject "a connection
 * field within a list field", so refunds (a list) cannot spread its
 * refundLineItems connection here. The bulk payload carries refund headers
 * only; the connector enriches refunded orders with per-order queries
 * afterwards (orderRefundsQuery below), which the non-bulk API supports.
 */
export function ordersBulkQuery(start: Date, end: Date): string {
  return `{
    orders(query: "created_at:>='${iso(start)}' AND created_at:<'${iso(end)}'") {
      edges { node {
        ${ORDER_FIELDS}
        lineItems { edges { node { ${LINE_ITEM_FIELDS} } } }
        refunds {
          ${REFUND_FIELDS}
        }
      } }
    }
  }`;
}

/** Per-order refund detail (post-bulk enrichment for refunded orders). */
export function orderRefundsQuery(): string {
  return `query grosslineOrderRefunds($id: ID!) {
    node(id: $id) {
      ... on Order {
        id
        refunds {
          ${REFUND_FIELDS}
          refundLineItems(first: 100) { edges { node { ${REFUND_LINE_ITEM_FIELDS} } } }
        }
      }
    }
  }`;
}

export function customersBulkQuery(start: Date, end: Date): string {
  return `{
    customers(query: "updated_at:>='${iso(start)}' AND updated_at:<'${iso(end)}'") {
      edges { node { ${CUSTOMER_FIELDS} } }
    }
  }`;
}

export function productsBulkQuery(start: Date, end: Date): string {
  return `{
    products(query: "updated_at:>='${iso(start)}' AND updated_at:<'${iso(end)}'") {
      edges { node {
        ${PRODUCT_FIELDS}
        variants { edges { node { ${VARIANT_FIELDS} } } }
      } }
    }
  }`;
}

/** Incremental: paginated queries by updated_at. */
export function ordersIncrementalQuery(): string {
  return `query grosslineOrdersIncremental($cursor: String, $search: String!) {
    orders(first: 50, after: $cursor, query: $search) {
      pageInfo { hasNextPage endCursor }
      edges { node {
        ${ORDER_FIELDS}
        lineItems(first: 100) { edges { node { ${LINE_ITEM_FIELDS} } } }
        refunds {
          ${REFUND_FIELDS}
          refundLineItems(first: 100) { edges { node { ${REFUND_LINE_ITEM_FIELDS} } } }
        }
      } }
    }
  }`;
}

export function customersIncrementalQuery(): string {
  return `query grosslineCustomersIncremental($cursor: String, $search: String!) {
    customers(first: 100, after: $cursor, query: $search) {
      pageInfo { hasNextPage endCursor }
      edges { node { ${CUSTOMER_FIELDS} } }
    }
  }`;
}

export function productsIncrementalQuery(): string {
  return `query grosslineProductsIncremental($cursor: String, $search: String!) {
    products(first: 50, after: $cursor, query: $search) {
      pageInfo { hasNextPage endCursor }
      edges { node {
        ${PRODUCT_FIELDS}
        variants(first: 100) { edges { node { ${VARIANT_FIELDS} } } }
      } }
    }
  }`;
}

export const SHOP_INFO_QUERY = `{
  shop {
    name
    myshopifyDomain
    ianaTimezone
    currencyCode
  }
}`;
