// Order payload → the facts every revenue metric consumes. Pure: raw payloads
// in, integer minor units out, per docs/metrics.md. Gift-card lines are
// excluded from gross/net/units at purchase; shipping-only refund amounts
// reduce shipping revenue, never net sales.
import { z } from 'zod';
import { decimalToMinorUnits } from '../money';

const shopMoney = z.object({ shopMoney: z.object({ amount: z.string(), currencyCode: z.string() }) });

const lineItemSchema = z
  .object({
    id: z.string(),
    quantity: z.number().int(),
    isGiftCard: z.boolean().nullish(),
    sku: z.string().nullish(),
    variant: z.object({ id: z.string() }).nullish(),
    originalUnitPriceSet: shopMoney,
    discountedUnitPriceSet: shopMoney.optional(),
  })
  .passthrough();

const refundLineItemSchema = z
  .object({
    quantity: z.number().int(),
    lineItem: z.object({ id: z.string() }).nullish(),
    subtotalSet: shopMoney,
    totalTaxSet: shopMoney.optional(),
  })
  .passthrough();

const refundSchema = z
  .object({
    id: z.string(),
    createdAt: z.string().optional(),
    totalRefundedSet: shopMoney.optional(),
    refundLineItems: z.array(refundLineItemSchema).optional(),
  })
  .passthrough();

const orderPayloadSchema = z
  .object({
    id: z.string(),
    processedAt: z.string().nullish(),
    createdAt: z.string(),
    cancelledAt: z.string().nullish(),
    currencyCode: z.string(),
    totalDiscountsSet: shopMoney.optional(),
    totalShippingPriceSet: shopMoney.optional(),
    totalTaxSet: shopMoney.optional(),
    customer: z.object({ id: z.string() }).nullish(),
    customerJourneySummary: z
      .object({ customerOrderIndex: z.number().nullish() })
      .passthrough()
      .nullish(),
    lineItems: z.array(lineItemSchema).optional(),
    refunds: z.array(refundSchema).optional(),
  })
  .passthrough();

export type OrderLineFact = {
  lineItemId: string;
  sku: string | null;
  variantId: string | null;
  quantity: number;
  isGiftCard: boolean;
  originalUnitPriceMinor: number;
  discountedUnitPriceMinor: number;
};

export type OrderFacts = {
  orderId: string;
  /** The order date, per docs/metrics.md: processedAt (createdAt only as fallback). */
  processedAt: Date;
  cancelled: boolean;
  currency: string;
  grossMinor: number;
  discountsMinor: number;
  returnsMinor: number;
  shippingChargedMinor: number;
  shippingRefundedMinor: number;
  taxMinor: number;
  units: number;
  hasReturn: boolean;
  /** Units refunded per line (for product-level refund analysis later). */
  refundedUnits: number;
  customerId: string | null;
  customerOrderIndex: number | null;
  lines: OrderLineFact[];
};

const minor = (m: { shopMoney: { amount: string; currencyCode: string } } | undefined): number =>
  m ? decimalToMinorUnits(m.shopMoney.amount, m.shopMoney.currencyCode) : 0;

export function orderFactsFromPayload(payload: unknown): OrderFacts {
  const order = orderPayloadSchema.parse(payload);

  const lines: OrderLineFact[] = (order.lineItems ?? []).map((li) => ({
    lineItemId: li.id,
    sku: li.sku ?? null,
    variantId: li.variant?.id ?? null,
    quantity: li.quantity,
    isGiftCard: li.isGiftCard ?? false,
    originalUnitPriceMinor: minor(li.originalUnitPriceSet),
    discountedUnitPriceMinor: li.discountedUnitPriceSet ? minor(li.discountedUnitPriceSet) : minor(li.originalUnitPriceSet),
  }));
  const giftLineIds = new Set(lines.filter((l) => l.isGiftCard).map((l) => l.lineItemId));
  const saleLines = lines.filter((l) => !l.isGiftCard);

  let returnsMinor = 0;
  let refundedUnits = 0;
  let shippingRefundedMinor = 0;
  let hasReturn = false;
  for (const refund of order.refunds ?? []) {
    let refundLineValueMinor = 0;
    for (const rli of refund.refundLineItems ?? []) {
      const lineId = rli.lineItem?.id;
      const lineValue = minor(rli.subtotalSet) + minor(rli.totalTaxSet);
      refundLineValueMinor += lineValue;
      if (lineId && giftLineIds.has(lineId)) continue; // gift lines never entered net sales
      returnsMinor += minor(rli.subtotalSet);
      refundedUnits += rli.quantity;
      if (rli.quantity > 0) hasReturn = true;
    }
    // Anything refunded beyond the line values is shipping (or goodwill on
    // shipping): reduces shipping revenue, never net sales (docs/metrics.md).
    const totalRefunded = minor(refund.totalRefundedSet);
    shippingRefundedMinor += Math.max(0, totalRefunded - refundLineValueMinor);
  }

  return {
    orderId: order.id,
    processedAt: new Date(order.processedAt ?? order.createdAt),
    cancelled: order.cancelledAt != null,
    currency: order.currencyCode,
    grossMinor: saleLines.reduce((sum, l) => sum + l.originalUnitPriceMinor * l.quantity, 0),
    discountsMinor: minor(order.totalDiscountsSet),
    returnsMinor,
    shippingChargedMinor: minor(order.totalShippingPriceSet),
    shippingRefundedMinor,
    taxMinor: minor(order.totalTaxSet),
    units: saleLines.reduce((sum, l) => sum + l.quantity, 0),
    hasReturn,
    refundedUnits,
    customerId: order.customer?.id ?? null,
    customerOrderIndex: order.customerJourneySummary?.customerOrderIndex ?? null,
    lines,
  };
}
