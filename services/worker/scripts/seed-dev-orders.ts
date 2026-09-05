// DEV-ONLY: seeds test orders into Rahul's own development store so the
// metric layer has real API shapes to work against.
//
//   pnpm --filter @grossline/worker exec tsx scripts/seed-dev-orders.ts
//
// HARD GUARD: refuses to run against any store that is not
// rahul-developer-store.myshopify.com. This is the one sanctioned exception
// to "we never write to a store" (CLAUDE.md) — it exists only because the
// store is ours and contains nothing real. Never extend it to merchant data.
import { randomUUID } from 'node:crypto';
import { z } from 'zod';
import { loadRootEnv, logger, minorUnitExponent } from '@grossline/core';
import { closeDbPools, getCredential, getTenantBySlug, listConnections } from '@grossline/db';
import { resolveShopifyAccess, strategyFromConnectionSettings } from '../src/connectors/shopify/auth';
import { shopifyGraphQL } from '../src/connectors/shopify/client';
import type { SyncContext } from '../src/connectors/types';

loadRootEnv();

const ALLOWED_SHOP = 'rahul-developer-store.myshopify.com';

if (process.env.NODE_ENV === 'production') {
  console.error('seed-dev-orders: refusing to run in production');
  process.exit(1);
}
if (process.env.SHOPIFY_SHOP_DOMAIN !== ALLOWED_SHOP) {
  console.error(`seed-dev-orders: refusing — SHOPIFY_SHOP_DOMAIN is not ${ALLOWED_SHOP}`);
  process.exit(1);
}

const fmt = (minor: number): string => (minor / 10 ** minorUnitExponent('USD')).toFixed(2);
const moneyBag = (amount: string) => ({ shopMoney: { amount, currencyCode: 'USD' } });
const daysAgo = (n: number): string => new Date(Date.now() - n * 86_400_000).toISOString();

const userErrorsSchema = z.array(z.object({ field: z.unknown(), message: z.string() }));

async function main(): Promise<void> {
  const tenant = await getTenantBySlug('rahul-developer-store');
  if (!tenant) throw new Error('tenant rahul-developer-store not found');
  const [conn] = await listConnections(tenant.id);
  if (!conn?.credentialRef) throw new Error('no shopify connection');
  const ctx: SyncContext = { tenantId: tenant.id, connectionId: conn.id, fetchImpl: fetch, log: logger };
  const credential = (await getCredential(tenant.id, conn.credentialRef))!;
  const creds = await resolveShopifyAccess(
    ctx,
    strategyFromConnectionSettings(conn.settings),
    credential.payload as Record<string, unknown>,
  );
  if (creds.shopDomain !== ALLOWED_SHOP) {
    throw new Error(`refusing — connection points at ${creds.shopDomain}, not ${ALLOWED_SHOP}`);
  }

  // Existing catalogue and customers, exactly as the store has them.
  const catalogue = z
    .object({
      products: z.object({
        edges: z.array(
          z.object({
            node: z.object({
              id: z.string(),
              title: z.string(),
              variants: z.object({
                edges: z.array(z.object({ node: z.object({ id: z.string(), sku: z.string().nullish() }) })),
              }),
            }),
          }),
        ),
      }),
      customers: z.object({
        edges: z.array(z.object({ node: z.object({ id: z.string() }) })),
      }),
    })
    .parse(
      await shopifyGraphQL(
        ctx,
        creds,
        `{
          products(first: 10) { edges { node { id title variants(first: 5) { edges { node { id sku } } } } } }
          customers(first: 10) { edges { node { id } } }
        }`,
      ),
    );

  const variants = catalogue.products.edges.map((e) => ({
    productTitle: e.node.title,
    variantId: e.node.variants.edges[0]!.node.id,
    sku: e.node.variants.edges[0]!.node.sku ?? undefined,
  }));
  const customers = catalogue.customers.edges.map((e) => e.node.id);
  if (variants.length < 3 || customers.length < 3) {
    throw new Error(`need at least 3 products and 3 customers (have ${variants.length}/${customers.length})`);
  }

  type Line = { variant: number; quantity: number; priceMinor: number; taxRate?: number };
  type Plan = {
    label: string;
    daysAgo: number;
    customer: number;
    lines: Line[];
    shippingMinor?: number;
    discount?: { kind: 'percent'; code: string; percentage: number } | { kind: 'fixed'; code: string; amountMinor: number };
    then?: 'partial-refund' | 'full-refund' | 'cancel';
  };

  const plans: Plan[] = [
    { label: 'plain, shipping charged, first order of repeat customer', daysAgo: 44, customer: 0, lines: [{ variant: 0, quantity: 1, priceMinor: 2400 }], shippingMinor: 700 },
    { label: 'discount code (10%), free shipping', daysAgo: 40, customer: 1, lines: [{ variant: 1, quantity: 2, priceMinor: 3500 }, { variant: 2, quantity: 1, priceMinor: 1800 }], discount: { kind: 'percent', code: 'WELCOME10', percentage: 10 } },
    { label: 'multi-line mixed quantities with tax, shipping charged', daysAgo: 35, customer: 2, lines: [{ variant: 0, quantity: 3, priceMinor: 2400, taxRate: 0.0875 }, { variant: 3, quantity: 2, priceMinor: 5200, taxRate: 0.0875 }, { variant: 4, quantity: 1, priceMinor: 9900, taxRate: 0.0875 }], shippingMinor: 1250 },
    { label: 'partial refund (one line item, partial quantity)', daysAgo: 30, customer: 1, lines: [{ variant: 2, quantity: 2, priceMinor: 1800 }, { variant: 3, quantity: 1, priceMinor: 5200 }], shippingMinor: 500, then: 'partial-refund' },
    { label: 'fully refunded order', daysAgo: 25, customer: 2, lines: [{ variant: 4, quantity: 2, priceMinor: 9900 }], then: 'full-refund' },
    { label: 'cancelled order', daysAgo: 20, customer: 3 % customers.length, lines: [{ variant: 1, quantity: 1, priceMinor: 3500 }], then: 'cancel' },
    { label: 'repeat customer second order', daysAgo: 15, customer: 0, lines: [{ variant: 2, quantity: 1, priceMinor: 1800 }, { variant: 0, quantity: 1, priceMinor: 2400 }], shippingMinor: 700 },
    { label: 'free shipping with tax line', daysAgo: 10, customer: 3 % customers.length, lines: [{ variant: 3, quantity: 1, priceMinor: 5200, taxRate: 0.0875 }] },
    { label: 'fixed discount code, shipping charged', daysAgo: 5, customer: 1, lines: [{ variant: 0, quantity: 2, priceMinor: 2400 }], shippingMinor: 500, discount: { kind: 'fixed', code: 'FIVER', amountMinor: 500 } },
    { label: 'small recent order', daysAgo: 2, customer: 2, lines: [{ variant: 2, quantity: 1, priceMinor: 1800 }] },
  ];

  const created: { label: string; id: string; name: string }[] = [];

  // Resume support: skip already-created plans after a mid-run failure.
  const startIndex = Number(process.argv[2] ?? 0);

  for (const plan of plans.slice(startIndex)) {
    const order: Record<string, unknown> = {
      currency: 'USD',
      financialStatus: 'PAID',
      processedAt: daysAgo(plan.daysAgo),
      customer: { toAssociate: { id: customers[plan.customer % customers.length] } },
      lineItems: plan.lines.map((l) => ({
        variantId: variants[l.variant % variants.length]!.variantId,
        quantity: l.quantity,
        priceSet: moneyBag(fmt(l.priceMinor)),
        ...(l.taxRate
          ? {
              taxLines: [
                {
                  title: 'State Tax',
                  rate: l.taxRate,
                  priceSet: moneyBag(fmt(Math.round(l.priceMinor * l.quantity * l.taxRate))),
                },
              ],
            }
          : {}),
      })),
      ...(plan.shippingMinor
        ? { shippingLines: [{ title: 'Standard Shipping', priceSet: moneyBag(fmt(plan.shippingMinor)) }] }
        : {}),
      ...(plan.discount
        ? {
            discountCode:
              plan.discount.kind === 'percent'
                ? { itemPercentageDiscountCode: { code: plan.discount.code, percentage: plan.discount.percentage } }
                : { itemFixedDiscountCode: { code: plan.discount.code, amountSet: moneyBag(fmt(plan.discount.amountMinor)) } },
          }
        : {}),
    };

    const result = z
      .object({
        orderCreate: z.object({
          order: z
            .object({
              id: z.string(),
              name: z.string(),
              lineItems: z.object({
                edges: z.array(z.object({ node: z.object({ id: z.string(), quantity: z.number() }) })),
              }),
            })
            .nullable(),
          userErrors: userErrorsSchema,
        }),
      })
      .parse(
        await shopifyGraphQL(
          ctx,
          creds,
          `mutation seedOrder($order: OrderCreateOrderInput!) {
            orderCreate(order: $order) {
              order { id name lineItems(first: 10) { edges { node { id quantity } } } }
              userErrors { field message }
            }
          }`,
          { order },
        ),
      );
    if (!result.orderCreate.order) {
      console.error(`FAILED [${plan.label}]:`, result.orderCreate.userErrors.map((e) => e.message).join('; '));
      continue;
    }
    const createdOrder = result.orderCreate.order;
    console.log(`created ${createdOrder.name} — ${plan.label}`);
    created.push({ label: plan.label, id: createdOrder.id, name: createdOrder.name });

    if (plan.then === 'partial-refund' || plan.then === 'full-refund') {
      const refundLines =
        plan.then === 'partial-refund'
          ? [{ lineItemId: createdOrder.lineItems.edges[0]!.node.id, quantity: 1 }]
          : createdOrder.lineItems.edges.map((e) => ({ lineItemId: e.node.id, quantity: e.node.quantity }));
      const refund = z
        .object({
          refundCreate: z.object({
            refund: z.object({ id: z.string() }).nullable(),
            userErrors: userErrorsSchema,
          }),
        })
        .parse(
          await shopifyGraphQL(
            ctx,
            creds,
            // 2026-07 requires @idempotent on refundCreate (live finding).
            `mutation seedRefund($input: RefundInput!, $key: String!) {
              refundCreate(input: $input) @idempotent(key: $key) { refund { id } userErrors { field message } }
            }`,
            {
              key: randomUUID(),
              input: {
                orderId: createdOrder.id,
                note: plan.then === 'partial-refund' ? 'one item came back' : 'entire order returned',
                refundLineItems: refundLines,
              },
            },
          ),
        );
      console.log(
        refund.refundCreate.refund
          ? `  refunded (${plan.then})`
          : `  REFUND FAILED: ${refund.refundCreate.userErrors.map((e) => e.message).join('; ')}`,
      );
    }

    if (plan.then === 'cancel') {
      const cancel = z
        .object({
          orderCancel: z.object({
            job: z.object({ id: z.string() }).nullable(),
            orderCancelUserErrors: userErrorsSchema,
          }),
        })
        .parse(
          await shopifyGraphQL(
            ctx,
            creds,
            `mutation seedCancel($orderId: ID!, $reason: OrderCancelReason!, $refund: Boolean!, $restock: Boolean!) {
              orderCancel(orderId: $orderId, reason: $reason, refund: $refund, restock: $restock) {
                job { id }
                orderCancelUserErrors { field message }
              }
            }`,
            { orderId: createdOrder.id, reason: 'CUSTOMER', refund: true, restock: true },
          ),
        );
      console.log(
        cancel.orderCancel.job
          ? '  cancellation queued'
          : `  CANCEL FAILED: ${cancel.orderCancel.orderCancelUserErrors.map((e) => e.message).join('; ')}`,
      );
    }
  }

  console.log(`\nseeded ${created.length}/${plans.length} orders`);
}

main()
  .then(() => closeDbPools())
  .catch(async (err) => {
    console.error('seed-dev-orders failed:', err instanceof Error ? err.message : err);
    await closeDbPools();
    process.exit(1);
  });
