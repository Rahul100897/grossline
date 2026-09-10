// Report PDF download (docs/phase-5.md task B4). Renders the stored snapshot's
// HTML to PDF with the report page options (margins + page-number footer). The
// snapshot is the immutable record; the preview uses the same HTML.
import { NextResponse, type NextRequest } from 'next/server';
import { getReport } from '@grossline/db';
import { renderReportHtml, REPORT_PDF_OPTIONS, type ReportModel } from '@grossline/worker/report-html';
import { buildReportModel } from '@grossline/worker/report-model';
import { getSession } from '../../../../lib/auth';
import { htmlToPdf } from '../../../../lib/pdf';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

export async function GET(request: NextRequest): Promise<Response> {
  const session = await getSession();
  if (!session) return new NextResponse('Unauthorized', { status: 401 });

  const tenantId = request.nextUrl.searchParams.get('tenant');
  const period = request.nextUrl.searchParams.get('period');
  if (!tenantId || !period) {
    return new NextResponse('tenant and period are required', { status: 400 });
  }

  const stored = await getReport(tenantId, period);
  let pdf: Buffer;
  let name = `report-${period.slice(0, 7)}`;
  try {
    const model = stored
      ? (stored.snapshot as ReportModel)
      : await buildReportModel(tenantId, period, { includeUnapproved: true });
    name = `${model.tenantName.replace(/[^a-z0-9]+/gi, '-')}-${period.slice(0, 7)}`;
    pdf = await htmlToPdf(renderReportHtml(model), REPORT_PDF_OPTIONS);
  } catch (error) {
    return new NextResponse(
      `PDF rendering failed: ${error instanceof Error ? error.message : 'unknown error'}`,
      { status: 500 },
    );
  }

  return new NextResponse(new Uint8Array(pdf), {
    headers: {
      'content-type': 'application/pdf',
      'content-disposition': `inline; filename="${name}.pdf"`,
    },
  });
}
