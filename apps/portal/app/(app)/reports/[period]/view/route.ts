import { NextResponse, type NextRequest } from 'next/server';
import { getReport } from '@grossline/db';
import { renderReportHtml, type ReportModel } from '@grossline/worker/report-html';
import { getPortalSession } from '../../../../../lib/session';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

// Serve the immutable snapshot the merchant was sent — scoped to the session's
// tenant, so a period guessed in the URL can only ever return this tenant's own
// (sent) report. Drafts are never served.
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

  const html = renderReportHtml(report.snapshot as unknown as ReportModel);
  return new NextResponse(html, { headers: { 'content-type': 'text/html; charset=utf-8' } });
}
