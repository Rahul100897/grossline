// The invoice template — a pure function from data to a self-contained HTML
// string (docs/phase-3.md task 3.6). No Playwright here so it stays testable;
// the renderer turns this into a PDF. The same HTML→PDF path the Phase 5
// monthly report will use.
import { minorUnitExponent } from '@grossline/core';

export type InvoiceLineView = {
  description: string;
  periodStart: string;
  periodEnd: string;
  amountMinor: number;
};

export type InvoiceView = {
  number: string;
  currency: string;
  issuedOn: string;
  dueOn: string;
  notes: string | null;
  lines: InvoiceLineView[];
};

export type BusinessView = {
  legalName: string;
  addressLines: string | null;
  gstin: string | null;
  lutNumber: string | null;
  invoiceEmail: string | null;
  bankDetails: string | null;
  footer: string | null;
};

export type BillToView = {
  name: string;
  addressLines?: string | null;
};

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function money(minor: number, currency: string): string {
  const exp = minorUnitExponent(currency);
  const formatted = (minor / 10 ** exp).toLocaleString('en-US', {
    minimumFractionDigits: exp,
    maximumFractionDigits: exp,
  });
  return `${currency} ${formatted}`;
}

function formatDate(iso: string): string {
  const d = new Date(`${iso}T00:00:00Z`);
  return d.toLocaleDateString('en-GB', {
    day: 'numeric',
    month: 'short',
    year: 'numeric',
    timeZone: 'UTC',
  });
}

/** Multi-line free text → escaped HTML with <br>. */
function multiline(value: string | null | undefined): string {
  if (!value) return '';
  return escapeHtml(value).replace(/\n/g, '<br>');
}

export function renderInvoiceHtml(args: {
  invoice: InvoiceView;
  business: BusinessView;
  billTo: BillToView;
}): string {
  const { invoice, business, billTo } = args;
  const total = invoice.lines.reduce((s, l) => s + l.amountMinor, 0);

  const rows = invoice.lines
    .map(
      (line) => `
      <tr>
        <td>
          ${escapeHtml(line.description)}
          <div class="period">${formatDate(line.periodStart)} – ${formatDate(line.periodEnd)}</div>
        </td>
        <td class="num">${money(line.amountMinor, invoice.currency)}</td>
      </tr>`,
    )
    .join('');

  // Zero-rated export-of-services wording. An LUT lets an Indian exporter
  // supply services zero-rated without paying IGST; the number is stated here.
  const lutLine = business.lutNumber
    ? `Supply meant for export of services under LUT — bond/LUT no. ${escapeHtml(
        business.lutNumber,
      )}. Zero-rated supply under section 16 of the IGST Act; no IGST charged.`
    : 'Export of services — zero-rated supply. No IGST charged.';

  return `<!doctype html>
<html>
<head>
<meta charset="utf-8">
<style>
  * { box-sizing: border-box; }
  body {
    font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif;
    color: #14181F; font-size: 12px; margin: 0; padding: 40px;
    font-variant-numeric: tabular-nums;
  }
  h1 { font-size: 22px; margin: 0 0 2px; letter-spacing: -0.01em; }
  .muted { color: #5C6470; }
  .head { display: flex; justify-content: space-between; align-items: flex-start; margin-bottom: 28px; }
  .issuer { text-align: right; }
  .parties { display: flex; justify-content: space-between; gap: 24px; margin-bottom: 24px; }
  .label { font-size: 10px; text-transform: uppercase; letter-spacing: 0.06em; color: #5C6470; margin-bottom: 4px; }
  table { width: 100%; border-collapse: collapse; margin-top: 8px; }
  th { text-align: left; font-size: 10px; text-transform: uppercase; letter-spacing: 0.06em; color: #5C6470; border-bottom: 1px solid #14181F; padding: 6px 0; }
  th.num, td.num { text-align: right; }
  td { padding: 10px 0; border-bottom: 1px solid #E6E5DF; vertical-align: top; }
  .period { color: #5C6470; font-size: 11px; margin-top: 2px; }
  .total td { border-bottom: none; border-top: 2px solid #14181F; font-weight: 600; padding-top: 12px; }
  .meta { margin-top: 28px; display: flex; gap: 40px; }
  .note { margin-top: 24px; padding: 12px 14px; background: #FAFAF7; border: 1px solid #E6E5DF; border-radius: 4px; }
  .lut { margin-top: 16px; font-size: 11px; color: #5C6470; }
  .footer { margin-top: 32px; padding-top: 12px; border-top: 1px solid #E6E5DF; font-size: 11px; color: #5C6470; }
</style>
</head>
<body>
  <div class="head">
    <div>
      <h1>Invoice</h1>
      <div class="muted">${escapeHtml(invoice.number)}</div>
    </div>
    <div class="issuer">
      <div style="font-weight:600">${escapeHtml(business.legalName)}</div>
      <div class="muted">${multiline(business.addressLines)}</div>
      ${business.gstin ? `<div class="muted">GSTIN ${escapeHtml(business.gstin)}</div>` : ''}
      ${business.invoiceEmail ? `<div class="muted">${escapeHtml(business.invoiceEmail)}</div>` : ''}
    </div>
  </div>

  <div class="parties">
    <div>
      <div class="label">Bill to</div>
      <div style="font-weight:600">${escapeHtml(billTo.name)}</div>
      <div class="muted">${multiline(billTo.addressLines)}</div>
    </div>
    <div>
      <div class="label">Issued</div>
      <div>${formatDate(invoice.issuedOn)}</div>
      <div class="label" style="margin-top:10px">Due</div>
      <div>${formatDate(invoice.dueOn)}</div>
    </div>
  </div>

  <table>
    <thead>
      <tr><th>Description</th><th class="num">Amount</th></tr>
    </thead>
    <tbody>
      ${rows}
      <tr class="total">
        <td>Total (${escapeHtml(invoice.currency)})</td>
        <td class="num">${money(total, invoice.currency)}</td>
      </tr>
    </tbody>
  </table>

  <div class="lut">${lutLine}</div>

  ${invoice.notes ? `<div class="note">${multiline(invoice.notes)}</div>` : ''}

  ${
    business.bankDetails
      ? `<div class="meta"><div><div class="label">Remittance</div><div class="muted">${multiline(
          business.bankDetails,
        )}</div></div></div>`
      : ''
  }

  ${business.footer ? `<div class="footer">${multiline(business.footer)}</div>` : ''}
</body>
</html>`;
}
