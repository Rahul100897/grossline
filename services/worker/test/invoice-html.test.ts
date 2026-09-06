import { describe, expect, it } from 'vitest';
import { renderInvoiceHtml } from '../src/billing/invoice-html';

const base = {
  invoice: {
    number: 'GL-2026-0001',
    currency: 'USD',
    issuedOn: '2026-09-01',
    dueOn: '2026-09-15',
    notes: null,
    lines: [
      { description: 'Analytics — July', periodStart: '2026-07-01', periodEnd: '2026-07-31', amountMinor: 49900 },
      { description: 'Analytics — August', periodStart: '2026-08-01', periodEnd: '2026-08-31', amountMinor: 49900 },
    ],
  },
  business: {
    legalName: 'Grossline Analytics',
    addressLines: 'Mumbai, India',
    gstin: '27ABCDE1234F1Z5',
    lutNumber: 'AD270423000123X',
    invoiceEmail: 'billing@example.com',
    bankDetails: 'HDFC • A/C 123',
    footer: 'Thank you',
  },
  billTo: { name: 'Acme Skincare' },
};

describe('renderInvoiceHtml', () => {
  it('totals the lines and formats money in the invoice currency', () => {
    const html = renderInvoiceHtml(base);
    // Two lines of 499.00 → total 998.00.
    expect(html).toContain('USD 998.00');
    expect(html).toContain('GL-2026-0001');
    expect(html).toContain('Acme Skincare');
  });

  it('states the LUT number and zero-rated export wording', () => {
    const html = renderInvoiceHtml(base);
    expect(html).toContain('AD270423000123X');
    expect(html).toContain('Zero-rated supply under section 16 of the IGST Act');
  });

  it('falls back to generic export wording without an LUT number', () => {
    const html = renderInvoiceHtml({
      ...base,
      business: { ...base.business, lutNumber: null },
    });
    expect(html).toContain('Export of services — zero-rated supply');
    expect(html).not.toContain('bond/LUT no.');
  });

  it('escapes HTML in free-text fields', () => {
    const html = renderInvoiceHtml({
      ...base,
      billTo: { name: '<script>alert(1)</script>' },
    });
    expect(html).not.toContain('<script>alert(1)</script>');
    expect(html).toContain('&lt;script&gt;');
  });
});
