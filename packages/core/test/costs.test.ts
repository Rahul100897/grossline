import { describe, expect, it } from 'vitest';
import {
  computeCostCoverage,
  latestEffective,
  resolveUnitCost,
  type ProductCostRow,
} from '../src/costs';
import { decimalToMinorUnits } from '../src/money';
import { parseCsv } from '../src/csv';

const cost = (over: Partial<ProductCostRow>): ProductCostRow => ({
  sku: 'AUR-MUG-01',
  variantId: '',
  unitCostMinor: 650,
  currency: 'USD',
  effectiveFrom: '2026-01-01',
  source: 'upload',
  ...over,
});

describe('resolveUnitCost', () => {
  it('a March order still resolves the March cost after a June upload', () => {
    const rows = [
      cost({ unitCostMinor: 1000, effectiveFrom: '2026-03-01' }),
      cost({ unitCostMinor: 1200, effectiveFrom: '2026-06-01' }), // uploaded later
    ];
    const march = resolveUnitCost(rows, { sku: 'AUR-MUG-01' }, '2026-03-15');
    expect(march).toMatchObject({ unitCostMinor: 1000, effectiveFrom: '2026-03-01' });
    const july = resolveUnitCost(rows, { sku: 'AUR-MUG-01' }, '2026-07-01');
    expect(july).toMatchObject({ unitCostMinor: 1200, effectiveFrom: '2026-06-01' });
  });

  it('an order before any effective date has a missing cost — never zero', () => {
    const rows = [cost({ effectiveFrom: '2026-03-01' })];
    expect(resolveUnitCost(rows, { sku: 'AUR-MUG-01' }, '2026-02-28')).toBeNull();
  });

  it('a variant-keyed row beats a sku-keyed row', () => {
    const rows = [
      cost({ unitCostMinor: 700 }),
      cost({ sku: '', variantId: 'gid://shopify/ProductVariant/7101001', unitCostMinor: 640 }),
    ];
    const resolved = resolveUnitCost(
      rows,
      { sku: 'AUR-MUG-01', variantId: 'gid://shopify/ProductVariant/7101001' },
      '2026-02-01',
    );
    expect(resolved!.unitCostMinor).toBe(640);
  });

  it('on a full tie the merchant upload beats the shopify sync', () => {
    const rows = [
      cost({ unitCostMinor: 600, source: 'shopify' }),
      cost({ unitCostMinor: 620, source: 'upload' }),
    ];
    expect(resolveUnitCost(rows, { sku: 'AUR-MUG-01' }, '2026-02-01')!.source).toBe('upload');
  });

  it('the effective date boundary is inclusive', () => {
    const rows = [cost({ effectiveFrom: '2026-03-01', unitCostMinor: 999 })];
    expect(resolveUnitCost(rows, { sku: 'AUR-MUG-01' }, '2026-03-01')!.unitCostMinor).toBe(999);
  });
});

describe('latestEffective', () => {
  it('picks the latest row on or before the date, or null', () => {
    const rows = [
      { effectiveFrom: '2026-01-01', v: 'jan' },
      { effectiveFrom: '2026-06-01', v: 'jun' },
    ];
    expect(latestEffective(rows, '2026-03-15')!.v).toBe('jan');
    expect(latestEffective(rows, '2026-06-01')!.v).toBe('jun');
    expect(latestEffective(rows, '2025-12-31')).toBeNull();
  });
});

describe('computeCostCoverage', () => {
  const line = (over: Partial<Parameters<typeof computeCostCoverage>[0][number]>) => ({
    orderId: 'o1',
    orderDate: '2026-02-10',
    sku: 'AUR-MUG-01',
    variantId: null,
    quantity: 1,
    lineRevenueMinor: 2400,
    currency: 'USD',
    ...over,
  });

  it('reports missing keys with line count, units and revenue at stake', () => {
    const rows = [cost({ effectiveFrom: '2026-01-01' })];
    const coverage = computeCostCoverage(
      [
        line({}),
        line({ orderId: 'o2', sku: 'NO-COST-01', quantity: 2, lineRevenueMinor: 8800 }),
        line({ orderId: 'o3', sku: 'NO-COST-01', quantity: 1, lineRevenueMinor: 4400 }),
      ],
      rows,
    );
    expect(coverage.totalLines).toBe(3);
    expect(coverage.costedLines).toBe(1);
    expect(coverage.coverageRate).toBeCloseTo(1 / 3, 10);
    expect(coverage.totalRevenueMinor).toBe(15600);
    expect(coverage.revenueAtStakeMinor).toBe(13200);
    expect(coverage.missing).toEqual([
      { sku: 'NO-COST-01', variantId: null, lines: 2, units: 3, revenueAtStakeMinor: 13200 },
    ]);
  });

  it('an empty window is fully covered, not divide-by-zero', () => {
    expect(computeCostCoverage([], []).coverageRate).toBe(1);
  });
});

describe('decimalToMinorUnits', () => {
  it('parses without ever holding a float', () => {
    expect(decimalToMinorUnits('14.00', 'USD')).toBe(1400);
    expect(decimalToMinorUnits('14.5', 'USD')).toBe(1450);
    expect(decimalToMinorUnits('14', 'USD')).toBe(1400);
    expect(decimalToMinorUnits('0.07', 'USD')).toBe(7);
    expect(decimalToMinorUnits('150', 'JPY')).toBe(150);
    expect(decimalToMinorUnits('1.234', 'KWD')).toBe(1234);
    expect(decimalToMinorUnits('-3.10', 'USD')).toBe(-310);
  });

  it('rejects excess precision and garbage', () => {
    expect(() => decimalToMinorUnits('1.005', 'USD')).toThrow(/precision/);
    expect(() => decimalToMinorUnits('1.5', 'JPY')).toThrow(/precision/);
    expect(() => decimalToMinorUnits('12,50', 'USD')).toThrow(/not a decimal/);
    expect(() => decimalToMinorUnits('', 'USD')).toThrow(/not a decimal/);
  });
});

describe('parseCsv', () => {
  it('handles quotes, embedded commas and CRLF', () => {
    const rows = parseCsv('sku,unit_cost\r\n"A,1",14.00\n"say ""hi""",2\n');
    expect(rows).toEqual([
      ['sku', 'unit_cost'],
      ['A,1', '14.00'],
      ['say "hi"', '2'],
    ]);
  });

  it('throws on an unterminated quote', () => {
    expect(() => parseCsv('a,"b\nc,d')).toThrow(/unterminated/);
  });
});
