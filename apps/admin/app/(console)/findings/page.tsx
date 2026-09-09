// Findings review queue (docs/phase-4.md task 4.5). Your editorial step: read
// each generated finding ranked by impact with its evidence, edit the text, and
// approve, dismiss or mark it deliberate. Nothing reaches a client without
// passing through here. State is shown clearly — a recurring finding on its
// third month reads differently from a new one.
import { listFindingPeriods, listFindings, listTenants, type Finding } from '@grossline/db';
import { requireSession } from '../../../lib/auth';
import { groupFindings } from '../../../lib/findings';
import {
  Absent,
  EmptyState,
  ErrorState,
  NumberStrip,
  PageHeader,
  SectionHeader,
} from '../../../components/ui';
import { FindingCard } from '../../../components/finding-card';
import { recompute } from './actions';

export const dynamic = 'force-dynamic';

const pickerInput =
  'rounded border border-hairline bg-panel px-2 py-1 text-[13px] text-ink outline-none focus:border-slate';

function Section({ title, findings, tenantId, period, right }: {
  title: string;
  findings: Finding[];
  tenantId: string;
  period: string;
  right?: React.ReactNode;
}) {
  if (findings.length === 0) return null;
  return (
    <>
      <SectionHeader title={`${title} (${findings.length})`} right={right} />
      <div className="flex flex-col gap-2">
        {findings.map((f) => (
          <FindingCard key={f.id} finding={f} tenantId={tenantId} period={period} />
        ))}
      </div>
    </>
  );
}

export default async function FindingsPage({
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
        <PageHeader title="Findings" />
        <ErrorState>Could not load tenants. Is the database up?</ErrorState>
      </>
    );
  }
  if (tenants.length === 0) {
    return (
      <>
        <PageHeader title="Findings" />
        <EmptyState>No tenants yet.</EmptyState>
      </>
    );
  }

  const tenantId = query.tenant && tenants.some((t) => t.id === query.tenant) ? query.tenant : tenants[0]!.id;
  const periods = await listFindingPeriods(tenantId);
  const period = query.period && periods.includes(query.period) ? query.period : (periods[0] ?? null);

  const findings = period ? await listFindings(tenantId, { period, includeSuppressed: true }) : [];
  const groups = groupFindings(findings);

  return (
    <>
      <PageHeader
        title="Findings"
        sub="Review, edit and approve. Nothing reaches a client without passing through here."
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
        <button type="submit" className="rounded border border-hairline px-2.5 py-1 text-[13px] hover:bg-hover">
          Show
        </button>
      </form>

      {!period ? (
        <EmptyState>
          No findings computed for this merchant yet.
          <form action={recompute} className="mt-3 flex items-center gap-2">
            <input type="hidden" name="tenantId" value={tenantId} />
            <input type="hidden" name="period" value={new Date().toISOString().slice(0, 8) + '01'} />
            <span className="text-[12px] text-slate">
              Compute after metrics exist: <code>pnpm --filter @grossline/worker findings:compute {tenantId} &lt;YYYY-MM&gt;</code>
            </span>
          </form>
        </EmptyState>
      ) : (
        <>
          <NumberStrip
            items={[
              { label: 'needs review', value: groups.needsReview.length, tone: groups.needsReview.length > 0 ? 'attn' : 'good' },
              { label: 'approved', value: groups.approved.length },
              { label: 'resolved this month', value: groups.resolved.length },
              {
                label: 'below the line',
                value: groups.suppressed.length > 0 ? groups.suppressed.length : <Absent reason="none" />,
              },
            ]}
          />

          <div className="mb-3 flex items-center gap-3">
            <form action={recompute}>
              <input type="hidden" name="tenantId" value={tenantId} />
              <input type="hidden" name="period" value={period} />
              <button type="submit" className="rounded border border-hairline px-2.5 py-1 text-[13px] hover:bg-hover">
                Recompute this month
              </button>
            </form>
            {query.error ? <span className="text-[12px] text-attn">{decodeURIComponent(query.error)}</span> : null}
          </div>

          {findings.length === 0 ? (
            <EmptyState>Nothing computed for this period.</EmptyState>
          ) : groups.needsReview.length === 0 && groups.approved.length === 0 ? (
            <div className="rounded border border-good-line bg-good-soft px-4 py-6 text-good">
              Nothing needs changing this month — spend is efficient and margins held. Any resolved or
              measurement-risk items are below.
            </div>
          ) : null}

          <Section title="Needs review" findings={groups.needsReview} tenantId={tenantId} period={period} />
          <Section title="Approved" findings={groups.approved} tenantId={tenantId} period={period} />
          <Section title="Resolved this month" findings={groups.resolved} tenantId={tenantId} period={period} />
          <Section
            title="Below the line"
            findings={groups.suppressed}
            tenantId={tenantId}
            period={period}
            right={<span className="text-[12px] text-slate">recorded, not sent</span>}
          />
          <Section title="Dismissed" findings={groups.dismissed} tenantId={tenantId} period={period} />

          {groups.needsReview.length === 0 && (groups.approved.length > 0 || groups.resolved.length > 0) ? (
            <p className="mt-4 text-[12px] text-good">
              Every finding this month has been reviewed. The approved set is ready to send.
            </p>
          ) : null}
        </>
      )}
    </>
  );
}
