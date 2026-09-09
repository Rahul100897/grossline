// The report build pipeline (docs/phase-5.md task B3): assemble the ReportModel
// from the live metric layer + findings, then persist it as the report snapshot.
// Once stored, the report renders from the snapshot forever — a past report is
// immune to later definition changes and cost re-uploads. Build is triggered
// from the console (task B4) or the nightly job after metrics compute.
import { logger } from '@grossline/core';
import { upsertReportSnapshot, type Report } from '@grossline/db';
import { buildReportModel, type BuildReportOptions } from './build-model';
import { renderReportHtml, type ReportModel } from './report-html';

export type BuildReportResult = { report: Report; model: ReportModel };

/** Build (or rebuild a draft) and persist the report snapshot for a period. */
export async function buildAndSaveReport(
  tenantId: string,
  period: string,
  opts: BuildReportOptions = {},
): Promise<BuildReportResult> {
  const model = await buildReportModel(tenantId, period, opts);
  const report = await upsertReportSnapshot(tenantId, period, model);
  logger.info('report built', {
    tenantId,
    period,
    status: report.status,
    findings: model.findings.length,
  });
  return { report, model };
}

/** Render the stored snapshot to HTML — the immutable record of what was sent. */
export function renderStoredReport(report: Report): string {
  return renderReportHtml(report.snapshot as ReportModel);
}
