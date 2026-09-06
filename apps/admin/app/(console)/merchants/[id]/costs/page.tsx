// Cost inputs (task 2.2), folded into the merchant detail page per task 3.3.
// Every save is a snapshot from its effective date — historical months never
// change when a later value is uploaded.
import { notFound } from 'next/navigation';
import { getTenant, listTenantCostInputs, type TenantCostInputs } from '@grossline/db';
import { requireSession } from '../../../../../lib/auth';
import { formatMinor } from '../../../../../lib/format';
import {
  Absent,
  EmptyState,
  Panel,
  SectionHeader,
  Table,
  Td,
  Th,
  Tr,
} from '../../../../../components/ui';
import { Field, FormNotice, SubmitButton } from '../../../../../components/forms';
import { saveCostInputs } from './actions';

export const dynamic = 'force-dynamic';

const percent = (bp: number | null): string | null =>
  bp === null ? null : `${(bp / 100).toFixed(2)}%`;

export default async function MerchantCostsPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ saved?: string; error?: string }>;
}) {
  await requireSession();
  const { id } = await params;
  const { saved, error } = await searchParams;
  const tenant = await getTenant(id);
  if (!tenant) notFound();

  const history = (await listTenantCostInputs(id)).slice().reverse(); // newest first
  const today = new Date().toISOString().slice(0, 10);

  return (
    <>
      <p className="mb-4 max-w-xl text-slate">
        Merchant-supplied costs and targets. Every save is a snapshot from its effective date —
        historical months never change.
      </p>
      <FormNotice saved={saved} error={error} />

      <form action={saveCostInputs} className="grid max-w-xl grid-cols-1 gap-4 sm:grid-cols-2">
        <input type="hidden" name="tenantId" value={tenant.id} />
        <Field label="Effective from" name="effectiveFrom" type="date" defaultValue={today} required />
        <Field
          label="Currency"
          name="currency"
          defaultValue={tenant.reportingCurrency}
          maxLength={3}
          required
        />
        <Field label="Payment fee %" name="paymentFeePercent" inputMode="decimal" placeholder="2.9" />
        <Field
          label="Payment fee fixed (per order)"
          name="paymentFeeFixed"
          inputMode="decimal"
          placeholder="0.30"
        />
        <Field label="Shipping cost (per order)" name="shippingCost" inputMode="decimal" placeholder="6.50" />
        <Field
          label="Fulfilment cost (per order)"
          name="fulfilmentCost"
          inputMode="decimal"
          placeholder="2.80"
        />
        <Field
          label="Packaging cost (per order)"
          name="packagingCost"
          inputMode="decimal"
          placeholder="0.90"
        />
        <Field
          label="Monthly revenue target"
          name="monthlyRevenueTarget"
          inputMode="decimal"
          placeholder="120000"
        />
        <Field
          label="Monthly ad spend target"
          name="monthlySpendTarget"
          inputMode="decimal"
          placeholder="25000"
        />
        <div className="sm:col-span-2">
          <SubmitButton>Save snapshot</SubmitButton>
        </div>
      </form>

      <SectionHeader title="History" />
      {history.length === 0 ? (
        <EmptyState>No cost inputs yet. The first snapshot above becomes the baseline.</EmptyState>
      ) : (
        <Panel>
          <Table>
            <thead>
              <tr>
                <Th>effective from</Th>
                <Th num>payment fee</Th>
                <Th num>shipping</Th>
                <Th num>fulfilment</Th>
                <Th num>packaging</Th>
                <Th num>revenue target</Th>
                <Th num>spend target</Th>
              </tr>
            </thead>
            <tbody>
              {history.map((row: TenantCostInputs) => (
                <Tr key={row.id}>
                  <Td quiet>{row.effectiveFrom}</Td>
                  <Td num>
                    {percent(row.paymentFeeBp) ?? <Absent reason="not set" />}
                    {row.paymentFeeFixedMinor !== null
                      ? ` + ${formatMinor(row.paymentFeeFixedMinor, row.currency)}`
                      : ''}
                  </Td>
                  <Td num>
                    {formatMinor(row.shippingCostPerOrderMinor, row.currency) ?? (
                      <Absent reason="not set" />
                    )}
                  </Td>
                  <Td num>
                    {formatMinor(row.fulfilmentCostPerOrderMinor, row.currency) ?? (
                      <Absent reason="not set" />
                    )}
                  </Td>
                  <Td num>
                    {formatMinor(row.packagingCostPerOrderMinor, row.currency) ?? (
                      <Absent reason="not set" />
                    )}
                  </Td>
                  <Td num>
                    {formatMinor(row.monthlyRevenueTargetMinor, row.currency) ?? (
                      <Absent reason="not set" />
                    )}
                  </Td>
                  <Td num>
                    {formatMinor(row.monthlySpendTargetMinor, row.currency) ?? (
                      <Absent reason="not set" />
                    )}
                  </Td>
                </Tr>
              ))}
            </tbody>
          </Table>
        </Panel>
      )}
    </>
  );
}
