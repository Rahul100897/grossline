// Demo tenant generator: 18 months of believable, deterministic data for a
// fictional brand, written through the same raw upsert helpers the connectors
// use. Fixed seed → fixed ids → re-running upserts the same rows (idempotent).
//
// Narrative requirements from docs/phase-1.md task 1.8:
//   seasonal revenue curve • Q4 spike • one underperforming Google campaign
//   • a discount-heavy month • one product with a high refund rate
//   • a stockout period. Flagged is_demo, no external connections.
import { eq } from 'drizzle-orm';
import { adminDb } from './client';
import { tenants } from './schema';
import { createTenant, type Tenant } from './admin';
import { createStore } from './stores';
import {
  upsertRawShopifyCustomers,
  upsertRawShopifyOrders,
  upsertRawShopifyProducts,
} from './raw-shopify';
import { upsertRawMetaInsights, type MetaInsightRow } from './raw-meta';
import { upsertRawGoogleAdsInsights, type GoogleAdsInsightRow } from './raw-google-ads';
import { ensureDemoConnection } from './seed-demo-connections';

// ---- deterministic randomness ----
function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const money = (n: number) => ({
  shopMoney: { amount: n.toFixed(2), currencyCode: 'USD' },
  presentmentMoney: { amount: n.toFixed(2), currencyCode: 'USD' },
});

// ---- catalogue ----
const PRODUCTS = [
  { id: 'gid://shopify/Product/91000001', title: 'Aurora Mug', sku: 'AUR-MUG-01', price: 24, cost: 6.5, variantId: 'gid://shopify/ProductVariant/92000001' },
  { id: 'gid://shopify/Product/91000002', title: 'Field Notebook', sku: 'FLD-NB-01', price: 50, cost: 14, variantId: 'gid://shopify/ProductVariant/92000002' },
  { id: 'gid://shopify/Product/91000003', title: 'Trailhead Flask', sku: 'TRL-FLK-01', price: 44, cost: 12.5, variantId: 'gid://shopify/ProductVariant/92000003' },
  { id: 'gid://shopify/Product/91000004', title: 'Summit Tote', sku: 'SMT-TOTE-01', price: 68, cost: 21, variantId: 'gid://shopify/ProductVariant/92000004' },
] as const;

const HIGH_REFUND_SKU = 'TRL-FLK-01'; // ~25% of flask line items get refunded
const STOCKOUT_SKU = 'AUR-MUG-01'; // unavailable month index 7, days 5–25

const CHANNELS = [
  { weight: 0.32, source: 'facebook', medium: 'paid', campaign: 'demo-prospecting' },
  { weight: 0.18, source: 'instagram', medium: 'paid', campaign: 'demo-retargeting' },
  { weight: 0.2, source: 'google', medium: 'cpc', campaign: 'search-brand' },
  { weight: 0.12, source: 'klaviyo', medium: 'email', campaign: 'newsletter' },
  { weight: 0.18, source: 'direct', medium: null, campaign: null },
] as const;

export type SeedSummary = {
  tenantId: string;
  storeId: string;
  months: number;
  orders: number;
  customers: number;
  products: number;
  metaRows: number;
  googleRows: number;
};

async function findOrCreateDemoTenant(): Promise<Tenant> {
  const [existing] = await adminDb().select().from(tenants).where(eq(tenants.slug, 'demo-brand'));
  if (existing) {
    if (existing.status !== 'active' || !existing.isDemo) {
      const [updated] = await adminDb()
        .update(tenants)
        .set({ status: 'active', isDemo: true })
        .where(eq(tenants.id, existing.id))
        .returning();
      return updated!;
    }
    return existing;
  }
  return createTenant({
    name: 'Demo Brand',
    slug: 'demo-brand',
    reportingCurrency: 'USD',
    reportingTimezone: 'America/New_York',
    status: 'active',
    isDemo: true,
  });
}

const chunk = <T,>(arr: T[], size: number): T[][] => {
  const out: T[][] = [];
  for (let i = 0; i < arr.length; i += size) out.push(arr.slice(i, i + size));
  return out;
};

export async function seedDemoTenant(now: Date = new Date()): Promise<SeedSummary> {
  const rand = mulberry32(0x9105e11);
  const tenant = await findOrCreateDemoTenant();
  const store = await createStore({
    tenantId: tenant.id,
    shopDomain: 'demo-brand.myshopify.com',
    storeCurrency: 'USD',
    storeTimezone: 'America/New_York',
  });

  const MONTHS = 18;
  // Months end with the last complete month.
  const firstMonth = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - MONTHS, 1));

  // ---- products ----
  await upsertRawShopifyProducts(
    tenant.id,
    store.id,
    PRODUCTS.map((p, i) => ({
      productId: p.id,
      payload: {
        id: p.id,
        title: p.title,
        status: 'ACTIVE',
        productType: 'Goods',
        vendor: 'Demo Brand',
        createdAt: firstMonth.toISOString(),
        updatedAt: now.toISOString(),
        variants: [
          {
            id: p.variantId,
            title: 'Default',
            sku: p.sku,
            price: p.price.toFixed(2),
            compareAtPrice: null,
            inventoryItem: {
              id: `gid://shopify/InventoryItem/9300000${i + 1}`,
              unitCost: { amount: p.cost.toFixed(2), currencyCode: 'USD' },
            },
          },
        ],
      },
      productUpdatedAt: now,
    })),
  );

  // ---- orders + customers ----
  type CustomerState = { id: string; orders: number; createdAt: string };
  const customers: CustomerState[] = [];
  let orderSeq = 0;
  let customerSeq = 0;
  let refundSeq = 0;

  const orderRows: Parameters<typeof upsertRawShopifyOrders>[2] = [];

  for (let m = 0; m < MONTHS; m++) {
    const monthStart = new Date(Date.UTC(firstMonth.getUTCFullYear(), firstMonth.getUTCMonth() + m, 1));
    const monthEnd = new Date(Date.UTC(monthStart.getUTCFullYear(), monthStart.getUTCMonth() + 1, 1));
    const daysInMonth = Math.round((monthEnd.getTime() - monthStart.getTime()) / 86_400_000);
    const calendarMonth = monthStart.getUTCMonth() + 1;

    // Revenue curve: growth + seasonality + Q4 spike.
    const growth = 1.02 ** m;
    const seasonal = 1 + 0.22 * Math.sin(((calendarMonth - 4) / 12) * 2 * Math.PI);
    const q4 = calendarMonth === 11 ? 1.9 : calendarMonth === 10 || calendarMonth === 12 ? 1.5 : 1;
    const monthlyRevenue = 12_000 * growth * seasonal * q4;
    const discountHeavyMonth = m === 2; // a January-style sale early in history
    const stockoutMonth = m === 7;

    const targetOrders = Math.max(20, Math.round(monthlyRevenue / 85));
    for (let i = 0; i < targetOrders; i++) {
      const day = 1 + Math.floor(rand() * daysInMonth);
      const stockout = stockoutMonth && day >= 5 && day <= 25;
      const createdAt = new Date(
        Date.UTC(
          monthStart.getUTCFullYear(),
          monthStart.getUTCMonth(),
          day,
          Math.floor(rand() * 24),
          Math.floor(rand() * 60),
        ),
      );

      // Customer: 62% new, else returning.
      let customer: CustomerState;
      if (customers.length === 0 || rand() < 0.62) {
        customer = {
          id: `gid://shopify/Customer/94${String(++customerSeq).padStart(6, '0')}`,
          orders: 0,
          createdAt: createdAt.toISOString(),
        };
        customers.push(customer);
      } else {
        customer = customers[Math.floor(rand() * customers.length)]!;
      }
      customer.orders++;

      // Line items: 1–3 products, skipping the stocked-out mug during the gap.
      const available = PRODUCTS.filter((p) => !(stockout && p.sku === STOCKOUT_SKU));
      const lineCount = 1 + Math.floor(rand() * 2.4);
      const chosen = new Map<string, { product: (typeof PRODUCTS)[number]; qty: number }>();
      for (let l = 0; l < lineCount; l++) {
        const product = available[Math.floor(rand() * available.length)]!;
        const existing = chosen.get(product.sku);
        if (existing) existing.qty++;
        else chosen.set(product.sku, { product, qty: 1 + (rand() < 0.2 ? 1 : 0) });
      }

      const discounted = discountHeavyMonth ? rand() < 0.7 : rand() < 0.12;
      const discountFraction = discounted ? 0.1 + rand() * 0.15 : 0;

      orderSeq++;
      const orderId = `gid://shopify/Order/95${String(orderSeq).padStart(7, '0')}`;
      let subtotal = 0;
      let discountTotal = 0;
      const lineItems = [...chosen.values()].map(({ product, qty }, idx) => {
        const gross = product.price * qty;
        const lineDiscount = gross * discountFraction;
        subtotal += gross - lineDiscount;
        discountTotal += lineDiscount;
        return {
          id: `gid://shopify/LineItem/96${String(orderSeq).padStart(7, '0')}${idx}`,
          title: product.title,
          quantity: qty,
          currentQuantity: qty,
          sku: product.sku,
          vendor: 'Demo Brand',
          product: { id: product.id },
          variant: { id: product.variantId },
          originalUnitPriceSet: money(product.price),
          discountedUnitPriceSet: money(product.price * (1 - discountFraction)),
          totalDiscountSet: money(lineDiscount),
          discountAllocations: lineDiscount > 0 ? [{ allocatedAmountSet: money(lineDiscount) }] : [],
          taxLines: [],
        };
      });

      const shipping = subtotal >= 100 ? 0 : 7;
      const cancelled = rand() < 0.012;

      // High-refund product: ~25% of flask lines refunded 2–14 days later.
      const refunds: Record<string, unknown>[] = [];
      let refundedTotal = 0;
      if (!cancelled) {
        for (const line of lineItems) {
          if (line.sku === HIGH_REFUND_SKU && rand() < 0.25) {
            const qty = 1;
            const amount = Number(line.discountedUnitPriceSet.shopMoney.amount) * qty;
            refundedTotal += amount;
            refunds.push({
              id: `gid://shopify/Refund/97${String(++refundSeq).padStart(7, '0')}`,
              createdAt: new Date(createdAt.getTime() + (2 + rand() * 12) * 86_400_000).toISOString(),
              note: 'demo refund',
              totalRefundedSet: money(amount),
              refundLineItems: [
                {
                  id: `gid://shopify/RefundLineItem/98${String(refundSeq).padStart(7, '0')}`,
                  quantity: qty,
                  restockType: 'RETURN',
                  lineItem: { id: line.id },
                  subtotalSet: money(amount),
                  totalTaxSet: money(0),
                },
              ],
            });
          }
        }
      }
      if (cancelled) {
        refundedTotal = subtotal + shipping;
        refunds.push({
          id: `gid://shopify/Refund/97${String(++refundSeq).padStart(7, '0')}`,
          createdAt: new Date(createdAt.getTime() + 86_400_000).toISOString(),
          note: 'cancelled',
          totalRefundedSet: money(refundedTotal),
          refundLineItems: [],
        });
      }

      const updatedAt =
        refunds.length > 0 ? (refunds.at(-1)!.createdAt as string) : createdAt.toISOString();
      const channelRoll = rand();
      let acc = 0;
      const channel = CHANNELS.find((c) => (acc += c.weight) >= channelRoll) ?? CHANNELS[4];

      orderRows.push({
        orderId,
        orderCreatedAt: createdAt,
        orderUpdatedAt: new Date(updatedAt),
        payload: {
          id: orderId,
          name: `#D${1000 + orderSeq}`,
          createdAt: createdAt.toISOString(),
          updatedAt,
          processedAt: createdAt.toISOString(),
          cancelledAt: cancelled ? new Date(createdAt.getTime() + 86_400_000).toISOString() : null,
          cancelReason: cancelled ? 'CUSTOMER' : null,
          closedAt: null,
          test: false,
          currencyCode: 'USD',
          presentmentCurrencyCode: 'USD',
          taxesIncluded: false,
          customer: { id: customer.id, numberOfOrders: String(customer.orders) },
          subtotalPriceSet: money(subtotal),
          totalDiscountsSet: money(discountTotal),
          totalTaxSet: money(0),
          totalShippingPriceSet: money(shipping),
          totalPriceSet: money(subtotal + shipping),
          totalRefundedSet: money(refundedTotal),
          customerJourneySummary: {
            daysToConversion: Math.floor(rand() * 14),
            customerOrderIndex: customer.orders,
            momentsCount: 1 + Math.floor(rand() * 5),
            firstVisit: {
              id: `gid://shopify/CustomerVisit/99${String(orderSeq).padStart(7, '0')}`,
              source: channel.source,
              sourceType: channel.medium === 'paid' ? 'SOCIAL' : channel.medium === 'cpc' ? 'SEARCH' : channel.medium === 'email' ? 'EMAIL' : 'DIRECT',
              referrerUrl: null,
              landingPage: 'https://demo-brand.example/',
              occurredAt: new Date(createdAt.getTime() - 86_400_000).toISOString(),
              utmParameters: channel.medium
                ? { source: channel.source, medium: channel.medium, campaign: channel.campaign, content: null, term: null }
                : null,
            },
            lastVisit: null,
          },
          lineItems,
          refunds,
        },
      });
    }
  }

  for (const batch of chunk(orderRows, 500)) {
    await upsertRawShopifyOrders(tenant.id, store.id, batch);
  }

  await upsertRawShopifyCustomers(
    tenant.id,
    store.id,
    customers.map((c, i) => ({
      customerId: c.id,
      payload: {
        id: c.id,
        createdAt: c.createdAt,
        updatedAt: now.toISOString(),
        numberOfOrders: String(c.orders),
        amountSpent: { amount: (c.orders * 85).toFixed(2), currencyCode: 'USD' },
        email: `demo-customer-${i + 1}@example.com`,
        displayName: `Demo Customer ${i + 1}`,
      },
      customerUpdatedAt: now,
    })),
  );

  // ---- ad platform rows ----
  const metaRows: MetaInsightRow[] = [];
  const googleRows: GoogleAdsInsightRow[] = [];
  const totalDays = Math.round(
    (Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1) - firstMonth.getTime()) / 86_400_000,
  );

  for (let d = 0; d < totalDays; d++) {
    const day = new Date(firstMonth.getTime() + d * 86_400_000);
    const dateStr = day.toISOString().slice(0, 10);
    const calendarMonth = day.getUTCMonth() + 1;
    const q4 = calendarMonth === 11 ? 1.8 : calendarMonth === 10 || calendarMonth === 12 ? 1.4 : 1;
    const seasonal = 1 + 0.2 * Math.sin(((calendarMonth - 4) / 12) * 2 * Math.PI);
    const daily = q4 * seasonal;

    // Meta: prospecting + retargeting, occasional zero-spend day.
    const metaCampaigns = [
      { id: '910000000000000001', name: 'demo-prospecting', base: 95 },
      { id: '910000000000000002', name: 'demo-retargeting', base: 30 },
    ];
    let accountSpend = 0;
    let accountPurchases = 0;
    let accountPurchaseValue = 0;
    for (const c of metaCampaigns) {
      const zero = rand() < 0.03;
      const spend = zero ? 0 : c.base * daily * (0.75 + rand() * 0.5);
      accountSpend += spend;
      const purchases = zero ? 0 : Math.round((spend / 22) * (0.8 + rand() * 0.4));
      accountPurchases += purchases;
      metaRows.push({
        adAccountId: 'act_demo_910000001',
        level: 'campaign',
        campaignId: c.id,
        date: dateStr,
        payload: {
          account_id: 'demo_910000001',
          account_currency: 'USD',
          campaign_id: c.id,
          campaign_name: c.name,
          date_start: dateStr,
          date_stop: dateStr,
          spend: spend.toFixed(2),
          impressions: String(Math.round(spend * 90)),
          clicks: String(Math.round(spend * 2.6)),
          actions: purchases > 0 ? [{ action_type: 'purchase', value: String(purchases) }] : [],
          action_values: (() => {
            if (purchases === 0) return [];
            const value = purchases * 82 * (0.9 + rand() * 0.3);
            accountPurchaseValue += value;
            return [{ action_type: 'purchase', value: value.toFixed(2) }];
          })(),
          attribution_setting: '7d_click_1d_view',
        },
      });
    }
    metaRows.push({
      adAccountId: 'act_demo_910000001',
      level: 'account',
      campaignId: '',
      date: dateStr,
      payload: {
        account_id: 'demo_910000001',
        account_currency: 'USD',
        date_start: dateStr,
        date_stop: dateStr,
        spend: accountSpend.toFixed(2),
        // The real API returns account-level actions when requested; the demo
        // account row is the sum of its campaigns, like Meta's own totals.
        actions:
          accountPurchases > 0 ? [{ action_type: 'purchase', value: String(accountPurchases) }] : [],
        action_values:
          accountPurchases > 0
            ? [{ action_type: 'purchase', value: accountPurchaseValue.toFixed(2) }]
            : [],
        attribution_setting: '7d_click_1d_view',
      },
    });

    // Google: healthy brand search + the underperformer.
    const googleCampaigns = [
      { id: '920000000001', name: 'search-brand', base: 45, roas: 5.5 },
      { id: '920000000002', name: 'pmax-underperformer', base: 55, roas: 0.4 },
    ];
    for (const c of googleCampaigns) {
      const spend = c.base * daily * (0.8 + rand() * 0.4);
      const conversionsValue = spend * c.roas * (0.85 + rand() * 0.3);
      const conversions = conversionsValue / 90;
      googleRows.push({
        customerId: '9200000001',
        campaignId: c.id,
        date: dateStr,
        payload: {
          campaign: {
            resourceName: `customers/9200000001/campaigns/${c.id}`,
            id: c.id,
            name: c.name,
            advertisingChannelType: c.name === 'search-brand' ? 'SEARCH' : 'PERFORMANCE_MAX',
          },
          metrics: {
            costMicros: String(Math.round(spend * 1_000_000)),
            impressions: String(Math.round(spend * 60)),
            clicks: String(Math.round(spend * 1.9)),
            conversions: Number(conversions.toFixed(2)),
            conversionsValue: Number(conversionsValue.toFixed(2)),
          },
          segments: { date: dateStr },
        },
      });
    }
  }

  // Raw ad tables key on connection_id — the demo tenant has no external
  // connections, so we mint one deterministic *internal* connection per
  // platform, flagged in settings as demo. It has no credential and no health
  // expectations; it exists so demo rows live in the same tables and shapes.
  await ensureDemoConnection(tenant.id, 'shopify', 'demo-brand.myshopify.com', store.id);
  const metaConn = await ensureDemoConnection(tenant.id, 'meta', 'act_demo_910000001');
  const googleConn = await ensureDemoConnection(tenant.id, 'google_ads', '9200000001');

  for (const batch of chunk(metaRows, 500)) {
    await upsertRawMetaInsights(tenant.id, metaConn, batch);
  }
  for (const batch of chunk(googleRows, 500)) {
    await upsertRawGoogleAdsInsights(tenant.id, googleConn, batch);
  }

  return {
    tenantId: tenant.id,
    storeId: store.id,
    months: MONTHS,
    orders: orderRows.length,
    customers: customers.length,
    products: PRODUCTS.length,
    metaRows: metaRows.length,
    googleRows: googleRows.length,
  };
}
