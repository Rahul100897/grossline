// Invoice PDF download (docs/phase-3.md task 3.6). Renders the pure invoice
// template to HTML, then Chromium (Playwright) to PDF — the same path Phase 5's
// monthly report will use. Server-only; the heavy playwright import lives here.
import { NextResponse, type NextRequest } from 'next/server';
import { getBusinessProfile, getInvoiceWithLines, getTenant } from '@grossline/db';
import { renderInvoiceHtml, type BusinessView } from '@grossline/worker/invoice-html';
import { getSession } from '../../../../lib/auth';
import { htmlToPdf } from '../../../../lib/pdf';

export const dynamic = 'force-dynamic';
// Chromium needs the Node runtime, not the edge runtime.
export const runtime = 'nodejs';

const FALLBACK_BUSINESS: BusinessView = {
  legalName: 'Set your business details in Settings',
  addressLines: null,
  gstin: null,
  lutNumber: null,
  invoiceEmail: null,
  bankDetails: null,
  footer: null,
};

export async function GET(request: NextRequest): Promise<Response> {
  const session = await getSession();
  if (!session) return new NextResponse('Unauthorized', { status: 401 });

  const tenantId = request.nextUrl.searchParams.get('tenant');
  const invoiceId = request.nextUrl.searchParams.get('invoice');
  if (!tenantId || !invoiceId) {
    return new NextResponse('tenant and invoice are required', { status: 400 });
  }

  const [invoice, tenant, business] = await Promise.all([
    getInvoiceWithLines(tenantId, invoiceId),
    getTenant(tenantId),
    getBusinessProfile(),
  ]);
  if (!invoice || !tenant) {
    return new NextResponse('invoice not found', { status: 404 });
  }

  const html = renderInvoiceHtml({
    invoice: {
      number: invoice.number,
      currency: invoice.currency,
      issuedOn: invoice.issuedOn,
      dueOn: invoice.dueOn,
      notes: invoice.notes,
      lines: invoice.lines.map((l) => ({
        description: l.description,
        periodStart: l.periodStart,
        periodEnd: l.periodEnd,
        amountMinor: l.amountMinor,
      })),
    },
    business: business
      ? {
          legalName: business.legalName,
          addressLines: business.addressLines,
          gstin: business.gstin,
          lutNumber: business.lutNumber,
          invoiceEmail: business.invoiceEmail,
          bankDetails: business.bankDetails,
          footer: business.footer,
        }
      : FALLBACK_BUSINESS,
    billTo: { name: tenant.name },
  });

  let pdf: Buffer;
  try {
    pdf = await htmlToPdf(html);
  } catch (error) {
    return new NextResponse(
      `PDF rendering failed: ${error instanceof Error ? error.message : 'unknown error'}`,
      { status: 500 },
    );
  }

  return new NextResponse(new Uint8Array(pdf), {
    headers: {
      'content-type': 'application/pdf',
      'content-disposition': `inline; filename="${invoice.number}.pdf"`,
    },
  });
}
