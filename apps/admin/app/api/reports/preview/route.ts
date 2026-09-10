// Report web preview (docs/phase-5.md task B4). Renders the stored snapshot to
// HTML — the same string the PDF is made from, so the preview and the PDF never
// drift. Falls back to a fresh (unsaved) build when no snapshot exists yet.
import { NextResponse, type NextRequest } from 'next/server';
import { getReport } from '@grossline/db';
import { renderReportHtml, type ReportModel } from '@grossline/worker/report-html';
import { buildReportModel } from '@grossline/worker/report-model';
import { getSession } from '../../../../lib/auth';

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
  let html: string;
  try {
    const model = stored
      ? (stored.snapshot as ReportModel)
      : await buildReportModel(tenantId, period, { includeUnapproved: true });
    html = renderReportHtml(model);
  } catch (error) {
    return new NextResponse(
      `Preview failed: ${error instanceof Error ? error.message : 'unknown error'}`,
      { status: 500 },
    );
  }
  return new NextResponse(html, { headers: { 'content-type': 'text/html; charset=utf-8' } });
}
