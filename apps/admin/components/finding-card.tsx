// One finding in the review queue (docs/phase-4.md task 4.5). Shows the
// structured record and its evidence, the (model-drafted, analyst-editable)
// text, and the review actions. Numbers come from the record; nothing here
// computes a figure.
import type { Finding } from '@grossline/db';
import { impactText, ruleTitle, statusLabel, statusTone } from '../lib/findings';
import { formatDate } from '../lib/format';
import { Badge } from './ui';
import { approve, dismiss, reopen, saveText, unapprove } from '../app/(console)/findings/actions';

function EvidenceTable({ evidence }: { evidence: Record<string, unknown> }) {
  const entries = Object.entries(evidence).filter(([k]) => k !== 'resolved');
  if (entries.length === 0) return null;
  return (
    <details className="mt-2">
      <summary className="cursor-pointer text-[12px] text-slate">evidence</summary>
      <table className="mt-1 border-collapse text-[12px]">
        <tbody>
          {entries.map(([k, v]) => (
            <tr key={k}>
              <td className="pr-3 text-slate">{k}</td>
              <td className="tabular-nums">{typeof v === 'boolean' ? String(v) : String(v)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </details>
  );
}

export function FindingCard({
  finding,
  tenantId,
  period,
}: {
  finding: Finding;
  tenantId: string;
  period: string;
}) {
  const impact = impactText(finding);
  const approved = finding.approvedAt !== null;
  const dismissed = finding.status === 'dismissed';
  const draft = finding.finalText ?? finding.draftText ?? '';
  const hidden = (
    <>
      <input type="hidden" name="tenantId" value={tenantId} />
      <input type="hidden" name="period" value={period} />
      <input type="hidden" name="id" value={finding.id} />
    </>
  );

  return (
    <div className="rounded border border-hairline bg-panel p-3">
      <div className="flex flex-wrap items-baseline gap-2">
        <span className="text-[13px] font-semibold">{ruleTitle(finding.ruleId)}</span>
        <span className="text-[12px] text-slate">{finding.entityLabel}</span>
        <Badge tone={statusTone(finding)}>{statusLabel(finding)}</Badge>
        {finding.severity === 'info' ? <Badge>measurement risk</Badge> : null}
        {approved ? <Badge tone="good">approved</Badge> : null}
        <span className="ml-auto text-[13px] font-semibold tabular-nums">
          {impact ?? <span className="text-[12px] font-normal italic text-slate">no money at stake</span>}
        </span>
      </div>

      <EvidenceTable evidence={(finding.evidence ?? {}) as Record<string, unknown>} />

      {finding.draftText && !finding.finalText ? (
        <p className="mt-2 whitespace-pre-wrap rounded bg-hover p-2 text-[12px] text-slate">
          <span className="mr-1 font-medium">draft:</span>
          {finding.draftText}
        </p>
      ) : null}

      {!dismissed ? (
        <form action={saveText} className="mt-2">
          {hidden}
          <textarea
            name="finalText"
            defaultValue={draft}
            rows={4}
            placeholder="The four-part note that reaches the client: what happened, what's at stake, what to do, what we check next month."
            className="w-full rounded border border-hairline bg-panel px-2 py-1.5 text-[13px] outline-none focus:border-slate"
          />
          <div className="mt-1 flex items-center gap-2">
            <button type="submit" className="rounded border border-hairline px-2.5 py-1 text-[13px] hover:bg-hover">
              Save text
            </button>
            {finding.editedAt ? <span className="text-[12px] text-slate">edited {formatDate(finding.editedAt)}</span> : null}
          </div>
        </form>
      ) : null}

      <div className="mt-2 flex flex-wrap items-center gap-2">
        {!dismissed && !approved ? (
          <form action={approve}>
            {hidden}
            <button type="submit" className="rounded border border-ink bg-ink px-2.5 py-1 text-[13px] text-paper hover:bg-slate">
              Approve
            </button>
          </form>
        ) : null}
        {approved ? (
          <form action={unapprove}>
            {hidden}
            <button type="submit" className="rounded border border-hairline px-2.5 py-1 text-[13px] hover:bg-hover">
              Unapprove
            </button>
          </form>
        ) : null}
        {dismissed ? (
          <form action={reopen} className="flex items-center gap-2">
            {hidden}
            <span className="text-[12px] text-slate">
              dismissed{finding.dismissedReason ? ` — ${finding.dismissedReason}` : ''}
            </span>
            <button type="submit" className="rounded border border-hairline px-2.5 py-1 text-[13px] hover:bg-hover">
              Reopen
            </button>
          </form>
        ) : (
          <form action={dismiss} className="flex flex-wrap items-center gap-1">
            {hidden}
            <input
              name="reason"
              placeholder="reason (optional)"
              className="rounded border border-hairline bg-panel px-2 py-1 text-[12px] outline-none focus:border-slate"
            />
            <label className="flex items-center gap-1 text-[12px] text-slate">
              <input type="checkbox" name="deliberate" />
              deliberate
            </label>
            <button type="submit" className="rounded border border-hairline px-2.5 py-1 text-[13px] hover:bg-hover">
              Dismiss
            </button>
          </form>
        )}
      </div>
    </div>
  );
}
