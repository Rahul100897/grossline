// Invoice detail (task 3.6): the lines and total, a link to the rendered PDF,
// recorded payments, and the two write actions — set status and record a
// payment (which can mark the invoice paid). Manual only; no gateway.
import Link from 'next/link';
import { notFound } from 'next/navigation';
import {
  getInvoiceWithLines,
  getTenant,
  listPaymentsForInvoice,
  type InvoiceWithLines,
  type Payment,
} from '@grossline/db';
import { requireSession } from '../../../../../lib/auth';
import { formatDate, formatMinor } from '../../../../../lib/format';
import {
  Absent,
  Badge,
  ErrorState,
  Panel,
  SectionHeader,
  Table,
  Td,
  Th,
  Tr,
} from '../../../../../components/ui';
import { Field, FormNotice, SubmitButton } from '../../../../../components/forms';
import { recordPaymentAction, setInvoiceStatus } from './actions';

export const dynamic = 'force-dynamic';

const INR = 'INR';

function statusTone(status: string): 'attn' | 'good' | 'neutral' {
  if (status === 'paid') return 'good';
  if (status === 'void') return 'neutral';
  return 'attn';
}

export default async function InvoiceDetailPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ tenant?: string; saved?: string; error?: string }>;
}) {
  await requireSession();
  const { id } = await params;
  const { tenant: tenantId, saved, error } = await searchParams;
  if (!tenantId) notFound();

  let invoice: InvoiceWithLines | null = null;
  let tenantName = '';
  let payments: Payment[] = [];
  let loadError = false;
  try {
    const [inv, tenant, pays] = await Promise.all([
      getInvoiceWithLines(tenantId, id),
      getTenant(tenantId),
      listPaymentsForInvoice(tenantId, id),
    ]);
    invoice = inv;
    tenantName = tenant?.name ?? '';
    payments = pays;
  } catch {
    loadError = true;
  }

  if (loadError) return <ErrorState>Could not load this invoice. Is the database up?</ErrorState>;
  if (!invoice) notFound();

  const pdfHref = `/api/invoices/pdf?tenant=${tenantId}&invoice=${invoice.id}`;

  return (
    <>
      <div className="mb-3 flex flex-wrap items-baseline gap-3">
        <h1 className="text-[15px] font-semibold tracking-tight">{invoice.number}</h1>
        <Badge tone={statusTone(invoice.status)}>{invoice.status}</Badge>
        <span className="text-[12px] text-slate">{tenantName}</span>
        <a href={pdfHref} target="_blank" rel="noreferrer" className="text-[13px] text-ink underline">
          view / download PDF
        </a>
        <Link href="/billing" className="text-[13px] text-slate hover:text-ink">
          ← billing
        </Link>
      </div>

      <FormNotice saved={saved} error={error} />

      <Panel>
        <Table>
          <thead>
            <tr>
              <Th>description</Th>
              <Th>period</Th>
              <Th num>amount</Th>
            </tr>
          </thead>
          <tbody>
            {invoice.lines.map((line) => (
              <Tr key={line.id}>
                <Td>{line.description}</Td>
                <Td quiet>
                  {formatDate(line.periodStart)} – {formatDate(line.periodEnd)}
                </Td>
                <Td num>{formatMinor(line.amountMinor, invoice!.currency)}</Td>
              </Tr>
            ))}
            <Tr>
              <Td>
                <span className="font-medium">Total</span>
              </Td>
              <Td quiet>
                issued {formatDate(invoice.issuedOn)} · due {formatDate(invoice.dueOn)}
              </Td>
              <Td num>
                <span className="font-medium">{formatMinor(invoice.totalMinor, invoice.currency)}</span>
              </Td>
            </Tr>
          </tbody>
        </Table>
      </Panel>

      {invoice.notes ? <p className="mt-3 max-w-xl text-slate">{invoice.notes}</p> : null}

      <SectionHeader title="Status" />
      <form action={setInvoiceStatus} className="flex flex-wrap items-center gap-2">
        <input type="hidden" name="tenantId" value={tenantId} />
        <input type="hidden" name="invoiceId" value={invoice.id} />
        {(['draft', 'sent', 'paid', 'void'] as const).map((s) => (
          <button
            key={s}
            type="submit"
            name="status"
            value={s}
            disabled={s === invoice!.status}
            className="rounded border border-hairline px-2.5 py-1 text-[13px] hover:bg-hover disabled:opacity-40"
          >
            mark {s}
          </button>
        ))}
      </form>

      <SectionHeader title="Payments" />
      {payments.length === 0 ? (
        <p className="mb-3 text-slate">No payments recorded yet.</p>
      ) : (
        <div className="mb-3">
          <Panel>
            <Table>
              <thead>
                <tr>
                  <Th>received</Th>
                  <Th num>gross</Th>
                  <Th num>Xflow fee</Th>
                  <Th num>net INR</Th>
                  <Th num>rate</Th>
                  <Th>reference</Th>
                </tr>
              </thead>
              <tbody>
                {payments.map((p) => (
                  <Tr key={p.id}>
                    <Td quiet>{formatDate(p.receivedOn)}</Td>
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
                    <Td quiet>{p.reference ?? <Absent reason="—" />}</Td>
                  </Tr>
                ))}
              </tbody>
            </Table>
          </Panel>
        </div>
      )}

      <SectionHeader title="Record a payment" />
      <form action={recordPaymentAction} className="grid max-w-2xl grid-cols-1 gap-4 sm:grid-cols-3">
        <input type="hidden" name="tenantId" value={tenantId} />
        <input type="hidden" name="invoiceId" value={invoice.id} />
        <Field
          label={`Gross (${invoice.currency})`}
          name="gross"
          inputMode="decimal"
          required
          hint="what the merchant paid"
        />
        <Field label="Currency" name="grossCurrency" defaultValue={invoice.currency} maxLength={3} required />
        <Field label="Received on" name="receivedOn" type="date" defaultValue={new Date().toISOString().slice(0, 10)} required />
        <Field label={`Xflow fee (${invoice.currency})`} name="xflowFee" inputMode="decimal" hint="optional" />
        <Field label="Net settled (INR)" name="netInr" inputMode="decimal" hint="what hit your INR account" />
        <Field label="USD→INR rate" name="fxRate" inputMode="decimal" hint="Xflow's effective rate" />
        <Field label="Reference" name="reference" hint="UTR / Xflow id" />
        <label className="flex items-center gap-2 self-end text-[13px]">
          <input type="checkbox" name="markPaid" defaultChecked />
          mark invoice paid
        </label>
        <div className="self-end">
          <SubmitButton>Record payment</SubmitButton>
        </div>
      </form>
    </>
  );
}
