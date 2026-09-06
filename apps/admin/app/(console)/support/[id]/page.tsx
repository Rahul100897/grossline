import Link from 'next/link';
import { notFound } from 'next/navigation';
import { getTicketWithMessages, getTenant, type TicketWithMessages } from '@grossline/db';
import { requireSession } from '../../../../lib/auth';
import { formatDate } from '../../../../lib/format';
import {
  Absent,
  Badge,
  ErrorState,
  Panel,
  SectionHeader,
} from '../../../../components/ui';
import { FormNotice, SelectField, SubmitButton, TextAreaField } from '../../../../components/forms';
import { replyToTicket, updateTicketMeta } from './actions';

export const dynamic = 'force-dynamic';

function statusTone(status: string): 'attn' | 'good' | 'neutral' {
  if (status === 'closed') return 'good';
  if (status === 'in_progress') return 'neutral';
  return 'attn';
}

export default async function TicketDetailPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ saved?: string; error?: string }>;
}) {
  await requireSession();
  const { id } = await params;
  const { saved, error } = await searchParams;

  let ticket: TicketWithMessages | null = null;
  let tenantName: string | null = null;
  let loadError = false;
  try {
    ticket = await getTicketWithMessages(id);
    if (ticket?.tenantId) tenantName = (await getTenant(ticket.tenantId))?.name ?? null;
  } catch {
    loadError = true;
  }

  if (loadError) return <ErrorState>Could not load this ticket. Is the database up?</ErrorState>;
  if (!ticket) notFound();

  return (
    <>
      <div className="mb-3 flex flex-wrap items-baseline gap-3">
        <h1 className="text-[15px] font-semibold tracking-tight">{ticket.subject}</h1>
        <Badge>{ticket.type}</Badge>
        <Badge tone={statusTone(ticket.status)}>{ticket.status.replace('_', ' ')}</Badge>
        <Badge tone={ticket.priority === 'high' ? 'attn' : 'neutral'}>{ticket.priority}</Badge>
        <Link href="/support" className="text-[13px] text-slate hover:text-ink">
          ← inbox
        </Link>
      </div>
      <p className="mb-4 text-[12px] text-slate">
        {ticket.source === 'in_app' ? 'in-app widget' : 'marketing site'} ·{' '}
        {ticket.submitterName ?? <Absent reason="anonymous" />}
        {ticket.submitterEmail ? ` · ${ticket.submitterEmail}` : ''}
        {tenantName ? ` · ${tenantName}` : ''} · {formatDate(ticket.createdAt)}
      </p>

      <FormNotice saved={saved} error={error} />

      <Panel>
        <div className="p-3">
          <div className="mb-1 text-[12px] text-slate">
            {ticket.submitterName ?? 'Submitter'} · {formatDate(ticket.createdAt)}
          </div>
          <div className="whitespace-pre-wrap text-[13px]">{ticket.body}</div>
        </div>
      </Panel>

      {ticket.messages.length > 0 ? (
        <>
          <SectionHeader title="Thread" />
          <div className="flex flex-col gap-2">
            {ticket.messages.map((m) => (
              <div
                key={m.id}
                className={`rounded border p-3 ${
                  m.author === 'admin'
                    ? 'border-hairline bg-panel'
                    : 'border-hairline bg-hover'
                }`}
              >
                <div className="mb-1 text-[12px] text-slate">
                  {m.author === 'admin' ? 'You' : ticket.submitterName ?? 'Submitter'} ·{' '}
                  {formatDate(m.createdAt)}
                  {m.author === 'admin' ? (m.emailed ? ' · emailed' : ' · not emailed') : ''}
                </div>
                <div className="whitespace-pre-wrap text-[13px]">{m.body}</div>
              </div>
            ))}
          </div>
        </>
      ) : null}

      <SectionHeader title="Reply" />
      <form action={replyToTicket} className="flex max-w-2xl flex-col gap-3">
        <input type="hidden" name="ticketId" value={ticket.id} />
        <TextAreaField label={ticket.submitterEmail ? `Reply (emails ${ticket.submitterEmail})` : 'Reply (no email on file — recorded only)'} name="body" rows={6} />
        <label className="flex items-center gap-2 text-[13px]">
          <input type="checkbox" name="close" defaultChecked />
          close the ticket after replying
        </label>
        <div>
          <SubmitButton>Send reply</SubmitButton>
        </div>
      </form>

      <SectionHeader title="Manage" />
      <form action={updateTicketMeta} className="grid max-w-xl grid-cols-1 gap-3 sm:grid-cols-2">
        <input type="hidden" name="ticketId" value={ticket.id} />
        <SelectField
          label="Status"
          name="status"
          defaultValue={ticket.status}
          options={['open', 'in_progress', 'closed'].map((s) => ({ value: s, label: s.replace('_', ' ') }))}
        />
        <SelectField
          label="Priority"
          name="priority"
          defaultValue={ticket.priority}
          options={['low', 'normal', 'high'].map((p) => ({ value: p, label: p }))}
        />
        <div className="sm:col-span-2">
          <TextAreaField label="Internal notes (never shown to the submitter)" name="notes" defaultValue={ticket.notes ?? ''} rows={4} />
        </div>
        <div className="sm:col-span-2">
          <SubmitButton>Save</SubmitButton>
        </div>
      </form>
    </>
  );
}
