import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { resolveUnitCost } from '@grossline/core';
import { createTenant } from '../src/admin';
import { closeDbPools } from '../src/client';
import { createStore } from '../src/stores';
import {
  importShopifyCosts,
  listCostableOrderLines,
  listProductCosts,
  upsertProductCosts,
} from '../src/product-costs';
import { upsertRawShopifyOrders, upsertRawShopifyProducts } from '../src/raw-shopify';

let tenantId: string;
let storeId: string;

const money = (amount: string) => ({
  shopMoney: { amount, currencyCode: 'USD' },
  presentmentMoney: { amount, currencyCode: 'USD' },
});

function orderPayload(input: {
  id: string;
  createdAt: string;
  cancelledAt?: string;
  lines: { sku: string; variantId: string; quantity: number; unitPrice: string }[];
}) {
  return {
    id: input.id,
    createdAt: input.createdAt,
    updatedAt: input.createdAt,
    cancelledAt: input.cancelledAt ?? null,
    lineItems: input.lines.map((l, i) => ({
      id: `${input.id}-line-${i}`,
      sku: l.sku,
      quantity: l.quantity,
      variant: { id: l.variantId },
      discountedUnitPriceSet: money(l.unitPrice),
    })),
  };
}

beforeAll(async () => {
  tenantId = (
    await createTenant({
      name: 'Costs tenant',
      slug: `costs-${randomUUID().slice(0, 8)}`,
      reportingCurrency: 'USD',
      reportingTimezone: 'UTC',
    })
  ).id;
  storeId = (
    await createStore({
      tenantId,
      shopDomain: `costs-${randomUUID().slice(0, 8)}.myshopify.com`,
      storeCurrency: 'USD',
      storeTimezone: 'UTC',
    })
  ).id;
});

afterAll(async () => {
  await closeDbPools();
});

describe('product costs with effective-from dates (task 2.1 done-when)', () => {
  it('a March order still resolves the March cost after a June upload', async () => {
    await upsertProductCosts(tenantId, [
      { sku: 'MUG-01', unitCostMinor: 1000, currency: 'USD', effectiveFrom: '2026-03-01', source: 'upload' },
    ]);
    // …months later, a new price list arrives:
    await upsertProductCosts(tenantId, [
      { sku: 'MUG-01', unitCostMinor: 1200, currency: 'USD', effectiveFrom: '2026-06-01', source: 'upload' },
    ]);

    const rows = await listProductCosts(tenantId);
    const march = resolveUnitCost(rows, { sku: 'MUG-01' }, '2026-03-15');
    expect(march).toMatchObject({ unitCostMinor: 1000, effectiveFrom: '2026-03-01' });
    const june = resolveUnitCost(rows, { sku: 'MUG-01' }, '2026-06-15');
    expect(june).toMatchObject({ unitCostMinor: 1200 });
  });

  it('re-uploading the same effective date replaces, never duplicates', async () => {
    await upsertProductCosts(tenantId, [
      { sku: 'MUG-01', unitCostMinor: 1050, currency: 'USD', effectiveFrom: '2026-03-01', source: 'upload' },
    ]);
    const rows = (await listProductCosts(tenantId)).filter(
      (r) => r.sku === 'MUG-01' && r.effectiveFrom === '2026-03-01',
    );
    expect(rows).toHaveLength(1);
    expect(rows[0]!.unitCostMinor).toBe(1050);
  });

  it('rejects a row with neither sku nor variant', async () => {
    await expect(
      upsertProductCosts(tenantId, [
        { unitCostMinor: 100, currency: 'USD', effectiveFrom: '2026-01-01', source: 'upload' },
      ]),
    ).rejects.toThrow();
  });
});

describe('costable order lines', () => {
  it('extracts lines in the window and excludes cancelled orders', async () => {
    await upsertRawShopifyOrders(tenantId, storeId, [
      {
        orderId: 'gid://shopify/Order/9101',
        payload: orderPayload({
          id: 'gid://shopify/Order/9101',
          createdAt: '2026-02-10T10:00:00Z',
          lines: [{ sku: 'MUG-01', variantId: 'gid://shopify/ProductVariant/1', quantity: 2, unitPrice: '24.00' }],
        }),
        orderCreatedAt: new Date('2026-02-10T10:00:00Z'),
        orderUpdatedAt: new Date('2026-02-10T10:00:00Z'),
      },
      {
        orderId: 'gid://shopify/Order/9102',
        payload: orderPayload({
          id: 'gid://shopify/Order/9102',
          createdAt: '2026-02-11T10:00:00Z',
          cancelledAt: '2026-02-12T10:00:00Z',
          lines: [{ sku: 'MUG-01', variantId: 'gid://shopify/ProductVariant/1', quantity: 1, unitPrice: '24.00' }],
        }),
        orderCreatedAt: new Date('2026-02-11T10:00:00Z'),
        orderUpdatedAt: new Date('2026-02-12T10:00:00Z'),
      },
      {
        orderId: 'gid://shopify/Order/9103',
        payload: orderPayload({
          id: 'gid://shopify/Order/9103',
          createdAt: '2026-03-05T10:00:00Z', // outside window
          lines: [{ sku: 'MUG-01', variantId: 'gid://shopify/ProductVariant/1', quantity: 1, unitPrice: '24.00' }],
        }),
        orderCreatedAt: new Date('2026-03-05T10:00:00Z'),
        orderUpdatedAt: new Date('2026-03-05T10:00:00Z'),
      },
    ]);

    const lines = await listCostableOrderLines(tenantId, {
      start: new Date('2026-02-01T00:00:00Z'),
      end: new Date('2026-03-01T00:00:00Z'),
    });
    expect(lines).toHaveLength(1);
    expect(lines[0]).toMatchObject({
      orderId: 'gid://shopify/Order/9101',
      sku: 'MUG-01',
      quantity: 2,
      lineRevenueMinor: 4800,
      currency: 'USD',
    });
  });
});

describe('shopify unitCost import', () => {
  it('first sighting applies from the epoch; a changed cost gets a new dated row', async () => {
    await upsertRawShopifyProducts(tenantId, storeId, [
      {
        productId: 'gid://shopify/Product/301',
        payload: {
          id: 'gid://shopify/Product/301',
          variants: [
            {
              id: 'gid://shopify/ProductVariant/3011',
              sku: 'FLASK-01',
              inventoryItem: { unitCost: { amount: '11.00', currencyCode: 'USD' } },
            },
            {
              id: 'gid://shopify/ProductVariant/3012',
              sku: 'FLASK-02',
              inventoryItem: { unitCost: null }, // merchant keeps no cost — stays missing
            },
          ],
        },
        productUpdatedAt: new Date(),
      },
    ]);

    const first = await importShopifyCosts(tenantId, '2026-09-05');
    expect(first).toEqual({ inserted: 1, unchanged: 0 });
    let rows = (await listProductCosts(tenantId)).filter((r) => r.sku === 'FLASK-01');
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ effectiveFrom: '1970-01-01', unitCostMinor: 1100, source: 'shopify' });

    // Same cost again: nothing changes.
    expect(await importShopifyCosts(tenantId, '2026-09-06')).toEqual({ inserted: 0, unchanged: 1 });

    // Cost changed in Shopify: history stays, new row applies from today.
    await upsertRawShopifyProducts(tenantId, storeId, [
      {
        productId: 'gid://shopify/Product/301',
        payload: {
          id: 'gid://shopify/Product/301',
          variants: [
            {
              id: 'gid://shopify/ProductVariant/3011',
              sku: 'FLASK-01',
              inventoryItem: { unitCost: { amount: '12.50', currencyCode: 'USD' } },
            },
          ],
        },
        productUpdatedAt: new Date(),
      },
    ]);
    expect(await importShopifyCosts(tenantId, '2026-09-07')).toEqual({ inserted: 1, unchanged: 0 });

    rows = (await listProductCosts(tenantId)).filter((r) => r.sku === 'FLASK-01');
    expect(rows).toHaveLength(2);
    const resolvedOld = resolveUnitCost(rows, { variantId: 'gid://shopify/ProductVariant/3011' }, '2026-06-01');
    expect(resolvedOld!.unitCostMinor).toBe(1100); // history frozen
    const resolvedNew = resolveUnitCost(rows, { variantId: 'gid://shopify/ProductVariant/3011' }, '2026-09-08');
    expect(resolvedNew!.unitCostMinor).toBe(1250);
  });
});
