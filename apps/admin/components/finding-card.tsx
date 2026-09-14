// One finding in the review queue (docs/phase-4.md task 4.5). Shows the
// structured record and its evidence, the (model-drafted, analyst-editable)
// text, and the review actions. Numbers come from the record; nothing here
// computes a figure.
import type { FindingPartKey } from '@grossline/core';
import type { Finding } from '@grossline/db';
import { impactText, ruleTitle, statusLabel, statusTone, templateParts } from '../lib/findings';
import { formatDate, formatMinor } from '../lib/format';
import { Badge } from './ui';
import { approve, dismiss, reopen, saveParts, unapprove } from '../app/(console)/findings/actions';

// The four review fields, in report order.
const PART_FIELDS: { key: FindingPartKey; label: string; rows: number }[] = [
  { key: 'whatHappened', label: 'What happened', rows: 3 },
  { key: 'atStake', label: "What's at stake", rows: 2 },
  { key: 'whatToDo', label: 'What to do', rows: 2 },
  { key: 'whatWeCheck', label: "What we'll check", rows: 2 },
];

function EvidenceTable({ evidence }: { evidence: Record<string, unknown> }) {
  const entries = Object.entries(evidence).filter(([k]) => k !== 'resolved');
  if (entries.length === 0) return null;
  return (
    <details className="mt-2">
      <summary className="cursor-pointer text-meta text-slate">evidence</summary>
      <table className="mt-1 border-collapse text-meta">
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
  const isGrowth = finding.family === 'growth';
  const isMeasurement = finding.family === 'measurement';
  const approved = finding.approvedAt !== null;
  const dismissed = finding.status === 'dismissed';
  // Prefill each field: the analyst's saved part wins, then the model's
  // guard-passed draft part, then the deterministic template part. Tracked per
  // part so a half-edited finding still shows a full note.
  const template = templateParts(finding);
  const finalParts = finding.finalParts ?? {};
  const draftParts = finding.draftParts ?? {};
  const partValue = (k: FindingPartKey): string => finalParts[k] ?? draftParts[k] ?? template[k];
  const partSource = (k: FindingPartKey): 'final' | 'draft' | 'template' =>
    finalParts[k] !== undefined ? 'final' : draftParts[k] !== undefined ? 'draft' : 'template';
  const hidden = (
    <>
      <input type="hidden" name="tenantId" value={tenantId} />
      <input type="hidden" name="period" value={period} />
      <input type="hidden" name="id" value={finding.id} />
    </>
  );

  return (
    <div
      className={`rounded border bg-panel p-3 ${
        isGrowth ? 'border-hairline border-l-2 border-l-good' : 'border-hairline'
      }`}
    >
      <div className="flex flex-wrap items-baseline gap-2">
        <span className="text-body font-semibold">{ruleTitle(finding.ruleId)}</span>
        <span className="text-meta text-slate">{finding.entityLabel}</span>
        <Badge tone={statusTone(finding)}>{statusLabel(finding)}</Badge>
        {/* Family, not severity: a growth finding must never read like a waste
            finding at a glance (task 5.A5). */}
        {isGrowth ? <Badge tone="good">growth opportunity</Badge> : null}
        {isMeasurement ? <Badge>measurement risk</Badge> : null}
        {approved ? <Badge tone="good">approved</Badge> : null}
        <span
          className={`ml-auto text-body font-semibold tabular-nums ${isGrowth ? 'text-good' : ''}`}
        >
          {isGrowth ? (
            finding.opportunityValueMinor !== null ? (
              `+${formatMinor(finding.opportunityValueMinor, finding.currency ?? 'USD')} opportunity`
            ) : (
              <span className="text-meta font-normal italic text-slate">opportunity</span>
            )
          ) : (
            (impact ?? (
              <span className="text-meta font-normal italic text-slate">no money at stake</span>
            ))
          )}
        </span>
      </div>

      <EvidenceTable evidence={(finding.evidence ?? {}) as Record<string, unknown>} />

      {!dismissed ? (
        <form action={saveParts} className="mt-2 flex flex-col gap-2">
          {hidden}
          {PART_FIELDS.map(({ key, label, rows }) => (
            <div key={key}>
              <div className="mb-1 flex items-baseline gap-2">
                <span className="text-meta font-medium">{label}</span>
                <span className="text-meta text-slate">· {partSource(key)}</span>
              </div>
              <textarea
                name={key}
                defaultValue={partValue(key)}
                rows={rows}
                className="w-full rounded border border-hairline bg-panel px-2 py-1.5 text-body outline-none focus:border-slate"
              />
            </div>
          ))}
          <div className="flex items-center gap-2">
            <button
              type="submit"
              className="rounded border border-hairline px-2.5 py-1 text-body hover:bg-hover"
            >
              Save note
            </button>
            {finding.editedAt ? (
              <span className="text-meta text-slate">edited {formatDate(finding.editedAt)}</span>
            ) : null}
            <span className="text-meta text-slate">A blank field falls back to the template.</span>
          </div>
        </form>
      ) : null}

      <div className="mt-2 flex flex-wrap items-center gap-2">
        {!dismissed && !approved ? (
          <form action={approve}>
            {hidden}
            <button
              type="submit"
              className="rounded border border-ink bg-ink px-2.5 py-1 text-body text-paper hover:bg-slate"
            >
              Approve
            </button>
          </form>
        ) : null}
        {approved ? (
          <form action={unapprove}>
            {hidden}
            <button
              type="submit"
              className="rounded border border-hairline px-2.5 py-1 text-body hover:bg-hover"
            >
              Unapprove
            </button>
          </form>
        ) : null}
        {dismissed ? (
          <form action={reopen} className="flex items-center gap-2">
            {hidden}
            <span className="text-meta text-slate">
              dismissed{finding.dismissedReason ? ` — ${finding.dismissedReason}` : ''}
            </span>
            <button
              type="submit"
              className="rounded border border-hairline px-2.5 py-1 text-body hover:bg-hover"
            >
              Reopen
            </button>
          </form>
        ) : (
          <form action={dismiss} className="flex flex-wrap items-center gap-1">
            {hidden}
            <input
              name="reason"
              placeholder="reason (optional)"
              className="rounded border border-hairline bg-panel px-2 py-1 text-meta outline-none focus:border-slate"
            />
            <label className="flex items-center gap-1 text-meta text-slate">
              <input type="checkbox" name="deliberate" />
              deliberate
            </label>
            <button
              type="submit"
              className="rounded border border-hairline px-2.5 py-1 text-body hover:bg-hover"
            >
              Dismiss
            </button>
          </form>
        )}
      </div>
    </div>
  );
}
