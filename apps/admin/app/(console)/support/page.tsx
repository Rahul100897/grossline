// Support inbox (docs/phase-3.md task 3.7): one destination for both intake
// points — the marketing-site form and the in-app widget. Filters on status,
// type and priority; open tickets first.
import Link from 'next/link';
import { listTickets, type Ticket } from '@grossline/db';
import { requireSession } from '../../../lib/auth';
import { formatDate } from '../../../lib/format';
import {
  Absent,
  Badge,
  EmptyState,
  ErrorState,
  PageHeader,
  Panel,
  Table,
  Td,
  Th,
  Tr,
} from '../../../components/ui';

export const dynamic = 'force-dynamic';

const filterInput =
  'rounded border border-hairline bg-panel px-2 py-1 text-[13px] text-ink outline-none focus:border-slate';

function priorityTone(priority: string): 'attn' | 'neutral' {
  return priority === 'high' ? 'attn' : 'neutral';
}
function statusTone(status: string): 'attn' | 'good' | 'neutral' {
  if (status === 'closed') return 'good';
  if (status === 'in_progress') return 'neutral';
  return 'attn';
}

export default async function SupportPage({
  searchParams,
}: {
  searchParams: Promise<{ status?: string; type?: string; priority?: string }>;
}) {
  await requireSession();
  const query = await searchParams;

  let tickets: Ticket[] | null = null;
  let loadError = false;
  try {
    tickets = await listTickets({
      status: query.status,
      type: query.type,
      priority: query.priority,
    });
  } catch {
    loadError = true;
  }

  if (loadError || !tickets) {
    return (
      <>
        <PageHeader title="Support" />
        <ErrorState>Could not load tickets. Is the database up? Check DATABASE_URL.</ErrorState>
      </>
    );
  }

  const filtering = Boolean(query.status || query.type || query.priority);

  return (
    <>
      <PageHeader title="Support" sub="Tickets from the marketing site and the in-app widget, in one place." />

      <form method="get" className="mb-3 flex flex-wrap items-center gap-2">
        <select name="status" defaultValue={query.status ?? ''} className={filterInput}>
          <option value="">any status</option>
          {['open', 'in_progress', 'closed'].map((s) => (
            <option key={s} value={s}>
              {s}
            </option>
          ))}
        </select>
        <select name="type" defaultValue={query.type ?? ''} className={filterInput}>
          <option value="">any type</option>
          {['bug', 'question', 'feedback', 'feature'].map((t) => (
            <option key={t} value={t}>
              {t}
            </option>
          ))}
        </select>
        <select name="priority" defaultValue={query.priority ?? ''} className={filterInput}>
          <option value="">any priority</option>
          {['low', 'normal', 'high'].map((p) => (
            <option key={p} value={p}>
              {p}
            </option>
          ))}
        </select>
        <button type="submit" className="rounded border border-hairline px-2.5 py-1 text-[13px] hover:bg-hover">
          Filter
        </button>
        {filtering ? (
          <Link href="/support" className="text-[13px] text-slate hover:text-ink">
            clear
          </Link>
        ) : null}
      </form>

      {tickets.length === 0 ? (
        <EmptyState>
          {filtering
            ? 'No tickets match that filter.'
            : 'No tickets yet. They arrive from the marketing-site form and the in-app widget.'}
        </EmptyState>
      ) : (
        <Panel>
          <Table>
            <thead>
              <tr>
                <Th>subject</Th>
                <Th>type</Th>
                <Th>from</Th>
                <Th>source</Th>
                <Th>priority</Th>
                <Th>status</Th>
                <Th>received</Th>
              </tr>
            </thead>
            <tbody>
              {tickets.map((t) => (
                <Tr key={t.id}>
                  <Td>
                    <Link href={`/support/${t.id}`} className="hover:underline">
                      {t.subject}
                    </Link>
                  </Td>
                  <Td quiet>{t.type}</Td>
                  <Td quiet>
                    {t.submitterName ?? t.submitterEmail ?? <Absent reason="anonymous" />}
                  </Td>
                  <Td quiet>{t.source === 'in_app' ? 'in-app' : 'marketing'}</Td>
                  <Td>
                    <Badge tone={priorityTone(t.priority)}>{t.priority}</Badge>
                  </Td>
                  <Td>
                    <Badge tone={statusTone(t.status)}>{t.status.replace('_', ' ')}</Badge>
                  </Td>
                  <Td quiet>{formatDate(t.createdAt)}</Td>
                </Tr>
              ))}
            </tbody>
          </Table>
        </Panel>
      )}
    </>
  );
}
