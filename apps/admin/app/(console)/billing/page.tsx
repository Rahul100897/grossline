// Billing overview (docs/phase-3.md task 3.6): invoices, payments with the
// Xflow fee and net INR, revenue by plan, and upcoming design-partner renewals.
import Link from 'next/link';
import {
  listAllInvoices,
  listAllPayments,
  revenueByPlan,
  type InvoiceListRow,
  type PaymentListRow,
  type PlanRevenue,
} from '@grossline/db';
import { requireSession } from '../../../lib/auth';
import {
  currentQuarter,
  quarterRange,
  sumPayments,
  upcomingRenewals,
  type Renewal,
} from '../../../lib/billing';
import { formatDate, formatMinor } from '../../../lib/format';
import {
  Absent,
  Badge,
  EmptyState,
  ErrorState,
  NumberStrip,
  PageHeader,
  Panel,
  SectionHeader,
  Table,
  Td,
  Th,
  Tr,
} from '../../../components/ui';

export const dynamic = 'force-dynamic';

const INR = 'INR';

function statusTone(status: string): 'attn' | 'good' | 'neutral' {
  if (status === 'paid') return 'good';
  if (status === 'void') return 'neutral';
  return 'attn'; // draft, sent — money still owed to you
}

function moneyMapToText(byCurrency: Map<string, number>): string | null {
  if (byCurrency.size === 0) return null;
  return [...byCurrency.entries()].map(([c, m]) => formatMinor(m, c)).join(' + ');
}

export default async function BillingPage() {
  await requireSession();

  let invoices: InvoiceListRow[] = [];
  let payments: PaymentListRow[] = [];
  let plans: PlanRevenue[] = [];
  let renewals: Renewal[] = [];
  let loadError = false;
  try {
    [invoices, payments, plans, renewals] = await Promise.all([
      listAllInvoices(),
      listAllPayments(),
      revenueByPlan(),
      upcomingRenewals(),
    ]);
  } catch {
    loadError = true;
  }

  if (loadError) {
    return (
      <>
        <PageHeader title="Billing" />
        <ErrorState>Could not load billing. Is the database up? Check DATABASE_URL.</ErrorState>
      </>
    );
  }

  const q = currentQuarter();
  const range = quarterRange(q.year, q.q);
  const collected = sumPayments(payments, range.start, range.end);
  const outstanding = new Map<string, number>();
  for (const inv of invoices) {
    if (inv.status === 'sent' || inv.status === 'draft') {
      outstanding.set(inv.currency, (outstanding.get(inv.currency) ?? 0) + inv.totalMinor);
    }
  }

  return (
    <>
      <PageHeader
        title="Billing"
        sub={
          <span className="flex items-center gap-3">
            Invoices, payments and renewals.
            <Link href="/billing/new" className="text-ink underline">
              New invoice
            </Link>
            <Link href="/settings/business" className="text-slate hover:text-ink">
              business details
            </Link>
          </span>
        }
      />

      <NumberStrip
        items={[
          {
            label: `collected ${q.label} (gross)`,
            value: moneyMapToText(collected.grossByCurrency) ?? <Absent reason="nothing yet" />,
          },
          {
            label: `net settled ${q.label}`,
            value: collected.netInrMinor > 0 ? formatMinor(collected.netInrMinor, INR) : <Absent reason="none recorded" />,
          },
          {
            label: 'outstanding (draft + sent)',
            value: moneyMapToText(outstanding) ?? <Absent reason="none" />,
            tone: outstanding.size > 0 ? 'attn' : 'good',
          },
        ]}
      />

      <SectionHeader title="Invoices" />
      {invoices.length === 0 ? (
        <EmptyState>
          No invoices yet.{' '}
          <Link href="/billing/new" className="text-ink underline">
            Raise the first one.
          </Link>
        </EmptyState>
      ) : (
        <Panel>
          <Table>
            <thead>
              <tr>
                <Th>number</Th>
                <Th>merchant</Th>
                <Th>issued</Th>
                <Th>due</Th>
                <Th num>amount</Th>
                <Th>status</Th>
              </tr>
            </thead>
            <tbody>
              {invoices.map((inv) => (
                <Tr key={inv.id}>
                  <Td>
                    <Link
                      href={`/billing/invoice/${inv.id}?tenant=${inv.tenantId}`}
                      className="hover:underline"
                    >
                      {inv.number}
                    </Link>
                  </Td>
                  <Td>{inv.tenantName}</Td>
                  <Td quiet>{formatDate(inv.issuedOn)}</Td>
                  <Td quiet>{formatDate(inv.dueOn)}</Td>
                  <Td num>{formatMinor(inv.totalMinor, inv.currency)}</Td>
                  <Td>
                    <Badge tone={statusTone(inv.status)}>{inv.status}</Badge>
                  </Td>
                </Tr>
              ))}
            </tbody>
          </Table>
        </Panel>
      )}

      <SectionHeader title="Payments" />
      {payments.length === 0 ? (
        <EmptyState>No payments recorded. Mark an invoice paid to record one.</EmptyState>
      ) : (
        <Panel>
          <Table>
            <thead>
              <tr>
                <Th>received</Th>
                <Th>invoice</Th>
                <Th>merchant</Th>
                <Th num>gross</Th>
                <Th num>Xflow fee</Th>
                <Th num>net INR</Th>
                <Th num>rate</Th>
              </tr>
            </thead>
            <tbody>
              {payments.map((p) => (
                <Tr key={p.id}>
                  <Td quiet>{formatDate(p.receivedOn)}</Td>
                  <Td>{p.invoiceNumber}</Td>
                  <Td quiet>{p.tenantName}</Td>
                  <Td num>{formatMinor(p.grossMinor, p.grossCurrency)}</Td>
                  <Td num>
                    {p.xflowFeeMinor !== null ? (
                      formatMinor(p.xflowFeeMinor, p.grossCurrency)
                    ) : (
                      <Absent reason="—" />
                    )}
                  </Td>
                  <Td num>
                    {p.netInrMinor !== null ? formatMinor(p.netInrMinor, INR) : <Absent reason="—" />}
                  </Td>
                  <Td num quiet>
                    {p.fxRate ?? <Absent reason="—" />}
                  </Td>
                </Tr>
              ))}
            </tbody>
          </Table>
        </Panel>
      )}

      <div className="grid gap-6 lg:grid-cols-2">
        <div>
          <SectionHeader title="Revenue by plan" />
          {plans.length === 0 ? (
            <EmptyState>No billed revenue yet.</EmptyState>
          ) : (
            <Panel>
              <Table>
                <thead>
                  <tr>
                    <Th>plan</Th>
                    <Th num>invoices</Th>
                    <Th num>billed</Th>
                  </tr>
                </thead>
                <tbody>
                  {plans.map((p) => (
                    <Tr key={p.plan}>
                      <Td>{p.plan}</Td>
                      <Td num quiet>
                        {p.invoiceCount}
                      </Td>
                      <Td num>{formatMinor(p.billedMinor, p.currency)}</Td>
                    </Tr>
                  ))}
                </tbody>
              </Table>
            </Panel>
          )}
        </div>

        <div>
          <SectionHeader title="Upcoming renewals" right={<span className="text-[12px] text-slate">next 90 days</span>} />
          {renewals.length === 0 ? (
            <EmptyState>No design-partner rates expiring in the next 90 days.</EmptyState>
          ) : (
            <Panel>
              <Table>
                <thead>
                  <tr>
                    <Th>merchant</Th>
                    <Th>what</Th>
                    <Th num>when</Th>
                  </tr>
                </thead>
                <tbody>
                  {renewals.map((r) => (
                    <Tr key={r.tenant.id}>
                      <Td>
                        <Link href={`/merchants/${r.tenant.id}/billing`} className="hover:underline">
                          {r.tenant.name}
                        </Link>
                      </Td>
                      <Td quiet>partner rate expires</Td>
                      <Td num quiet>
                        {formatDate(r.date)} ({r.daysAway}d)
                      </Td>
                    </Tr>
                  ))}
                </tbody>
              </Table>
            </Panel>
          )}
        </div>
      </div>
    </>
  );
}
