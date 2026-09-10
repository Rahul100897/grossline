// Reports surface (docs/phase-5.md task B4): per tenant and period — build,
// preview, download the PDF, send (gated), and an archive of what was sent.
// Nothing goes out unreviewed or unreconciled: the send gate blocks with clear
// reasons and the Send button is disabled until both conditions pass.
import {
  getReport,
  getTenant,
  listMetricPeriods,
  listReports,
  listTenants,
  type Report,
} from '@grossline/db';
import { buildWhatsAppSummary } from '@grossline/worker/report-whatsapp';
import type { ReportModel } from '@grossline/worker/report-html';
import { requireSession } from '../../../lib/auth';
import { computeSendGate } from '../../../lib/reports';
import { formatDate } from '../../../lib/format';
import { CopyBlock } from '../../../components/copy-block';
import {
  Badge,
  EmptyState,
  ErrorState,
  PageHeader,
  Panel,
  SectionHeader,
  Table,
  Td,
  Th,
  Tr,
} from '../../../components/ui';
import { approveReport, buildReport, sendReport } from './actions';

export const dynamic = 'force-dynamic';

const pickerInput =
  'rounded border border-hairline bg-panel px-2 py-1 text-[13px] text-ink outline-none focus:border-slate';
const btn = 'rounded border border-hairline px-2.5 py-1 text-[13px] hover:bg-hover';
const btnPrimary = 'rounded border border-ink bg-ink px-2.5 py-1 text-[13px] text-paper hover:bg-slate';

function statusTone(status: Report['status']): 'good' | 'attn' | 'neutral' {
  if (status === 'sent') return 'good';
  if (status === 'approved') return 'attn';
  return 'neutral';
}

export default async function ReportsPage({
  searchParams,
}: {
  searchParams: Promise<{ tenant?: string; period?: string; saved?: string; error?: string }>;
}) {
  await requireSession();
  const query = await searchParams;

  let tenants: { id: string; name: string }[] = [];
  let loadError = false;
  try {
    tenants = (await listTenants()).map((t) => ({ id: t.id, name: t.name }));
  } catch {
    loadError = true;
  }
  if (loadError) {
    return (
      <>
        <PageHeader title="Reports" />
        <ErrorState>Could not load tenants. Is the database up?</ErrorState>
      </>
    );
  }
  if (tenants.length === 0) {
    return (
      <>
        <PageHeader title="Reports" />
        <EmptyState>No tenants yet.</EmptyState>
      </>
    );
  }

  const tenantId = query.tenant && tenants.some((t) => t.id === query.tenant) ? query.tenant : tenants[0]!.id;
  const [tenant, periods, archive] = await Promise.all([
    getTenant(tenantId),
    listMetricPeriods(tenantId, 'month'),
    listReports(tenantId),
  ]);
  const period = query.period && periods.includes(query.period) ? query.period : (periods[0] ?? null);

  const report = period ? await getReport(tenantId, period) : null;
  const gate = period ? await computeSendGate(tenantId, period) : null;
  const previewUrl = period ? `/api/reports/preview?tenant=${tenantId}&period=${period}` : '#';
  const pdfUrl = period ? `/api/reports/pdf?tenant=${tenantId}&period=${period}` : '#';
  const sent = report?.status === 'sent';

  return (
    <>
      <PageHeader
        title="Reports"
        sub="Build, preview, send and archive the monthly report. Nothing goes out unreviewed or unreconciled."
      />

      <form method="get" className="mb-4 flex flex-wrap items-center gap-2">
        <select name="tenant" defaultValue={tenantId} className={pickerInput}>
          {tenants.map((t) => (
            <option key={t.id} value={t.id}>
              {t.name}
            </option>
          ))}
        </select>
        <select name="period" defaultValue={period ?? ''} className={pickerInput}>
          {periods.length === 0 ? (
            <option value="">no periods</option>
          ) : (
            periods.map((p) => (
              <option key={p} value={p}>
                {p.slice(0, 7)}
              </option>
            ))
          )}
        </select>
        <button type="submit" className={btn}>
          Show
        </button>
      </form>

      {query.saved ? (
        <p className="mb-3 text-[12px] text-good">{decodeURIComponent(query.saved) === '1' ? 'Saved.' : decodeURIComponent(query.saved)}</p>
      ) : null}
      {query.error ? <p className="mb-3 text-[12px] text-attn">{decodeURIComponent(query.error)}</p> : null}

      {!period ? (
        <EmptyState>
          No computed months for this merchant yet. Compute metrics first, then build the report.
        </EmptyState>
      ) : (
        <>
          <SectionHeader
            title={`${tenant?.name ?? ''} · ${period.slice(0, 7)}`}
            right={
              report ? (
                <Badge tone={statusTone(report.status)}>{report.status}</Badge>
              ) : (
                <span className="text-[12px] text-slate">not built</span>
              )
            }
          />
          <Panel>
            <div className="flex flex-col gap-3 p-1">
              {/* Build / preview / download */}
              <div className="flex flex-wrap items-center gap-2">
                <form action={buildReport}>
                  <input type="hidden" name="tenantId" value={tenantId} />
                  <input type="hidden" name="period" value={period} />
                  <button type="submit" className={btn} disabled={sent}>
                    {report ? 'Rebuild' : 'Build'}
                  </button>
                </form>
                <a href={previewUrl} target="_blank" rel="noreferrer" className={btn}>
                  Preview
                </a>
                <a href={pdfUrl} target="_blank" rel="noreferrer" className={btn}>
                  Download PDF
                </a>
                {report && report.status === 'draft' ? (
                  <form action={approveReport}>
                    <input type="hidden" name="tenantId" value={tenantId} />
                    <input type="hidden" name="period" value={period} />
                    <button type="submit" className={btn}>
                      Mark ready
                    </button>
                  </form>
                ) : null}
                {report ? <span className="text-[12px] text-slate">built {formatDate(report.builtAt)}</span> : null}
              </div>

              {/* Send gate */}
              {gate && !gate.canSend ? (
                <div className="rounded border border-attn-line bg-attn-soft px-3 py-2 text-[12px] text-attn">
                  <div className="font-semibold">Send is blocked:</div>
                  <ul className="ml-4 list-disc">
                    {gate.reasons.map((r) => (
                      <li key={r}>{r}</li>
                    ))}
                  </ul>
                </div>
              ) : gate ? (
                <div className="text-[12px] text-good">
                  Findings reviewed and reconciliation run — ready to send.
                </div>
              ) : null}

              {/* Send */}
              {sent ? (
                <div className="text-[12px] text-good">
                  Sent {report?.sentAt ? formatDate(report.sentAt) : ''} to{' '}
                  {Array.isArray(report?.recipients) ? (report!.recipients as string[]).join(', ') : ''}.
                </div>
              ) : (
                <form action={sendReport} className="flex flex-wrap items-center gap-2">
                  <input type="hidden" name="tenantId" value={tenantId} />
                  <input type="hidden" name="period" value={period} />
                  <input
                    name="recipients"
                    placeholder="recipient@merchant.com, …"
                    className={`${pickerInput} min-w-[260px]`}
                  />
                  <button type="submit" className={btnPrimary} disabled={!report || !(gate?.canSend ?? false)}>
                    Send
                  </button>
                  {!report ? <span className="text-[12px] text-slate">build the report first</span> : null}
                </form>
              )}
            </div>
          </Panel>

          {report ? (
            <>
              <SectionHeader
                title="WhatsApp summary"
                right={<span className="text-[12px] text-slate">paste into a chat on the day it lands</span>}
              />
              <Panel>
                <CopyBlock text={buildWhatsAppSummary(report.snapshot as ReportModel)} label="Copy summary" />
              </Panel>
            </>
          ) : null}

          <SectionHeader title="Archive" right={<span className="text-[12px] text-slate">what was built and sent</span>} />
          {archive.length === 0 ? (
            <EmptyState>No reports built yet.</EmptyState>
          ) : (
            <Panel>
              <Table>
                <thead>
                  <tr>
                    <Th>period</Th>
                    <Th>status</Th>
                    <Th>built</Th>
                    <Th>sent</Th>
                    <Th>recipients</Th>
                  </tr>
                </thead>
                <tbody>
                  {archive.map((r) => (
                    <Tr key={r.id}>
                      <Td>{r.period.slice(0, 7)}</Td>
                      <Td>
                        <Badge tone={statusTone(r.status)}>{r.status}</Badge>
                      </Td>
                      <Td quiet>{formatDate(r.builtAt)}</Td>
                      <Td quiet>{r.sentAt ? formatDate(r.sentAt) : '—'}</Td>
                      <Td quiet>
                        {Array.isArray(r.recipients) && r.recipients.length > 0
                          ? (r.recipients as string[]).join(', ')
                          : '—'}
                      </Td>
                    </Tr>
                  ))}
                </tbody>
              </Table>
            </Panel>
          )}
        </>
      )}
    </>
  );
}
