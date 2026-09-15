import { NextResponse, type NextRequest } from 'next/server';
import { getReport } from '@grossline/db';
import {
  renderReportHtml,
  REPORT_PDF_OPTIONS,
  type ReportModel,
} from '@grossline/worker/report-html';
import { htmlToPdf } from '@grossline/worker/pdf';
import { getPortalSession } from '../../../../../lib/session';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ period: string }> },
): Promise<Response> {
  const session = await getPortalSession();
  if (!session) return new NextResponse('Unauthorized', { status: 401 });
  const { period } = await params;
  if (!/^\d{4}-\d{2}$/.test(period)) return new NextResponse('Not found', { status: 404 });

  const report = await getReport(session.activeTenantId, `${period}-01`);
  if (!report || report.status !== 'sent') return new NextResponse('Not found', { status: 404 });

  const model = report.snapshot as unknown as ReportModel;
  const pdf = await htmlToPdf(renderReportHtml(model), REPORT_PDF_OPTIONS);
  const name = `${model.tenantName.replace(/[^a-z0-9]+/gi, '-')}-${period}`;
  return new NextResponse(new Uint8Array(pdf), {
    headers: {
      'content-type': 'application/pdf',
      'content-disposition': `inline; filename="${name}.pdf"`,
    },
  });
}
