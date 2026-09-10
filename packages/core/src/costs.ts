// Cost resolution over effective-from dated rows. Pure functions — the
// database hands in rows, these decide. docs/metrics.md: "COGS — unit cost ×
// quantity, using the cost effective on the order date. […] If a SKU has no
// cost for that date, it is counted as missing, not as zero."

export type ProductCostRow = {
  /** '' when keyed by variant only */
  sku: string;
  /** '' when keyed by sku only */
  variantId: string;
  unitCostMinor: number;
  currency: string;
  /** YYYY-MM-DD */
  effectiveFrom: string;
  source: 'shopify' | 'upload';
};

export type ResolvedCost = Pick<
  ProductCostRow,
  'unitCostMinor' | 'currency' | 'effectiveFrom' | 'source'
>;

const dateOnly = (d: Date | string): string =>
  typeof d === 'string' ? d.slice(0, 10) : d.toISOString().slice(0, 10);

/**
 * The cost effective on the order date for one line: variant-keyed rows beat
 * sku-keyed rows (more specific), later effective_from beats earlier, and on
 * a full tie a merchant upload beats the Shopify-synced value. Returns null —
 * never zero — when nothing matches.
 */
export function resolveUnitCost(
  rows: ProductCostRow[],
  line: { sku?: string | null; variantId?: string | null },
  orderDate: Date | string,
): ResolvedCost | null {
  const onDate = dateOnly(orderDate);
  const candidates = rows.filter((row) => {
    if (row.effectiveFrom > onDate) return false;
    const variantMatch = row.variantId !== '' && row.variantId === (line.variantId ?? '');
    const skuMatch = row.sku !== '' && row.sku === (line.sku ?? '');
    return variantMatch || skuMatch;
  });
  if (candidates.length === 0) return null;
  const specificity = (row: ProductCostRow): number =>
    row.variantId !== '' && row.variantId === (line.variantId ?? '') ? 1 : 0;
  candidates.sort((a, b) => {
    const bySpecificity = specificity(b) - specificity(a);
    if (bySpecificity !== 0) return bySpecificity;
    if (a.effectiveFrom !== b.effectiveFrom) return b.effectiveFrom < a.effectiveFrom ? -1 : 1;
    return (b.source === 'upload' ? 1 : 0) - (a.source === 'upload' ? 1 : 0);
  });
  const winner = candidates[0]!;
  return {
    unitCostMinor: winner.unitCostMinor,
    currency: winner.currency,
    effectiveFrom: winner.effectiveFrom,
    source: winner.source,
  };
}

/**
 * Generic effective-from resolution: the latest row whose effectiveFrom is on
 * or before the date, or null. Shared by product costs and merchant cost
 * inputs so "historical months never change" has exactly one implementation.
 */
export function latestEffective<T extends { effectiveFrom: string }>(
  rows: T[],
  onDate: Date | string,
): T | null {
  const date = dateOnly(onDate);
  let winner: T | null = null;
  for (const row of rows) {
    if (row.effectiveFrom > date) continue;
    if (!winner || row.effectiveFrom > winner.effectiveFrom) winner = row;
  }
  return winner;
}

export type OrderLineForCosting = {
  orderId: string;
  orderDate: string; // YYYY-MM-DD (UTC of order createdAt; boundary applied upstream)
  sku: string | null;
  variantId: string | null;
  quantity: number;
  /** Discounted line revenue in minor units of `currency`. */
  lineRevenueMinor: number;
  currency: string;
};

/** Where resolved costs actually came from — 100% coverage must not hide assumptions. */
export type CostProvenance = {
  /** Merchant CSV upload with a real effective date. */
  uploadLines: number;
  /** Shopify sync rows carrying a real (change-dated) effective date. */
  shopifyDatedLines: number;
  /**
   * Shopify sync rows epoch-dated at first sighting: the cost was ASSUMED to
   * apply to all history because Shopify keeps no cost history.
   */
  shopifyEpochAssumedLines: number;
};

export const EPOCH_EFFECTIVE_FROM = '1970-01-01';

export type CostCoverage = {
  totalLines: number;
  costedLines: number;
  /** 0..1; 1 when there are no lines at all (nothing missing). */
  coverageRate: number;
  provenance: CostProvenance;
  totalRevenueMinor: number;
  revenueAtStakeMinor: number;
  /** One entry per distinct missing sku/variant key, largest revenue first. */
  missing: {
    sku: string | null;
    variantId: string | null;
    lines: number;
    units: number;
    revenueAtStakeMinor: number;
  }[];
};

/** What share of order lines can be costed, and what is at stake where not. */
export function computeCostCoverage(
  lines: OrderLineForCosting[],
  costRows: ProductCostRow[],
): CostCoverage {
  let costedLines = 0;
  let totalRevenueMinor = 0;
  let revenueAtStakeMinor = 0;
  const provenance: CostProvenance = {
    uploadLines: 0,
    shopifyDatedLines: 0,
    shopifyEpochAssumedLines: 0,
  };
  const missing = new Map<
    string,
    {
      sku: string | null;
      variantId: string | null;
      lines: number;
      units: number;
      revenueAtStakeMinor: number;
    }
  >();

  for (const line of lines) {
    totalRevenueMinor += line.lineRevenueMinor;
    const resolved = resolveUnitCost(costRows, line, line.orderDate);
    if (resolved) {
      costedLines++;
      if (resolved.source === 'upload') provenance.uploadLines++;
      else if (resolved.effectiveFrom === EPOCH_EFFECTIVE_FROM)
        provenance.shopifyEpochAssumedLines++;
      else provenance.shopifyDatedLines++;
      continue;
    }
    revenueAtStakeMinor += line.lineRevenueMinor;
    const key = `${line.sku ?? ''}\0${line.variantId ?? ''}`;
    const entry = missing.get(key) ?? {
      sku: line.sku,
      variantId: line.variantId,
      lines: 0,
      units: 0,
      revenueAtStakeMinor: 0,
    };
    entry.lines++;
    entry.units += line.quantity;
    entry.revenueAtStakeMinor += line.lineRevenueMinor;
    missing.set(key, entry);
  }

  return {
    totalLines: lines.length,
    costedLines,
    coverageRate: lines.length === 0 ? 1 : costedLines / lines.length,
    provenance,
    totalRevenueMinor,
    revenueAtStakeMinor,
    missing: [...missing.values()].sort((a, b) => b.revenueAtStakeMinor - a.revenueAtStakeMinor),
  };
}
