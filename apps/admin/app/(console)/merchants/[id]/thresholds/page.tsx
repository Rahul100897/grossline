// Per-tenant finding thresholds (docs/phase-4.md task 4.2). Calibrated from the
// tenant's own history + margin structure; editable here. Saving marks them
// analyst-edited so an automatic recalibration leaves them alone; the
// Recalibrate button recomputes from history and clears that flag.
import { notFound } from 'next/navigation';
import { getCalibration, getTenant, type TenantCalibration } from '@grossline/db';
import { requireSession } from '../../../../../lib/auth';
import { formatDate } from '../../../../../lib/format';
import { Absent, Badge, EmptyState, PageHeader, SectionHeader } from '../../../../../components/ui';
import { Field, FormNotice, SubmitButton } from '../../../../../components/forms';
import { recalibrate, saveThresholds } from './actions';

export const dynamic = 'force-dynamic';

const pct = (v: number): string => String(Math.round(v * 1000) / 10);

export default async function ThresholdsPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ saved?: string; error?: string; recalibrated?: string }>;
}) {
  await requireSession();
  const { id } = await params;
  const { saved, error, recalibrated } = await searchParams;
  const tenant = await getTenant(id);
  if (!tenant) notFound();

  let cal: TenantCalibration | null = null;
  try {
    cal = await getCalibration(id);
  } catch {
    // fall through to empty state
  }

  return (
    <>
      <PageHeader
        title="Finding thresholds"
        sub="Calibrated from this merchant's own history and margin. Editing overrides the calibration; Recalibrate recomputes it."
      />
      <FormNotice saved={saved || recalibrated} error={error} />

      {!cal ? (
        <EmptyState>
          Not calibrated yet. Run a recalibration once the merchant has computed metrics.
          <form action={recalibrate} className="mt-3">
            <input type="hidden" name="tenantId" value={tenant.id} />
            <button
              type="submit"
              className="rounded border border-hairline px-2.5 py-1 text-[13px] hover:bg-hover"
            >
              Recalibrate from history
            </button>
          </form>
        </EmptyState>
      ) : (
        <>
          <div className="mb-4 flex flex-wrap items-center gap-3 text-[12px] text-slate">
            <span>
              {cal.edited ? <Badge tone="attn">hand-edited</Badge> : <Badge tone="good">auto-calibrated</Badge>}
            </span>
            <span>computed {formatDate(cal.computedAt)}</span>
            <form action={recalibrate}>
              <input type="hidden" name="tenantId" value={tenant.id} />
              <button type="submit" className="rounded border border-hairline px-2.5 py-1 hover:bg-hover">
                Recalibrate from history
              </button>
            </form>
          </div>

          <form action={saveThresholds} className="grid max-w-2xl grid-cols-1 gap-4 sm:grid-cols-2">
            <input type="hidden" name="tenantId" value={tenant.id} />
            <Field
              label="Break-even MER"
              name="breakEvenMer"
              inputMode="decimal"
              defaultValue={cal.thresholds.breakEvenMer === null ? '' : String(cal.thresholds.breakEvenMer)}
              hint={cal.thresholds.breakEvenMer === null ? 'no margin data — leave blank' : 'from contribution margin'}
            />
            <Field
              label={`Min impact (${tenant.reportingCurrency} minor)`}
              name="minImpactMinor"
              inputMode="decimal"
              defaultValue={String(cal.thresholds.minImpactMinor)}
              hint="findings below this are suppressed"
            />
            <Field
              label={`Dead-campaign spend floor (${tenant.reportingCurrency} minor)`}
              name="deadCampaignSpendFloorMinor"
              inputMode="decimal"
              defaultValue={String(cal.thresholds.deadCampaignSpendFloorMinor)}
            />
            <Field
              label="Branded-share ceiling (%)"
              name="brandedShareCeil"
              inputMode="decimal"
              defaultValue={pct(cal.thresholds.brandedShareCeil)}
            />
            <Field
              label="Refund-rate multiple (×)"
              name="refundRateMultiple"
              inputMode="decimal"
              defaultValue={String(cal.thresholds.refundRateMultiple)}
            />
            <Field
              label="Discount-leakage ceiling (points %)"
              name="discountLeakageDeltaCeil"
              inputMode="decimal"
              defaultValue={pct(cal.thresholds.discountLeakageDeltaCeil)}
            />
            <Field
              label="Claim-gap tolerance (%)"
              name="claimGapTolerance"
              inputMode="decimal"
              defaultValue={pct(cal.thresholds.claimGapTolerance)}
            />
            <Field
              label={`CAC ceiling (${tenant.reportingCurrency} minor)`}
              name="cacCeilingMinor"
              inputMode="decimal"
              defaultValue={cal.thresholds.cacCeilingMinor === null ? '' : String(cal.thresholds.cacCeilingMinor)}
              hint={cal.thresholds.cacCeilingMinor === null ? 'too little history' : ''}
            />
            <Field
              label="Pacing overage (%)"
              name="pacingOveragePct"
              inputMode="decimal"
              defaultValue={pct(cal.thresholds.pacingOveragePct)}
            />
            <Field
              label={`Search-term-waste floor (${tenant.reportingCurrency} minor)`}
              name="searchTermWasteFloorMinor"
              inputMode="decimal"
              defaultValue={String(cal.thresholds.searchTermWasteFloorMinor)}
            />
            <div className="sm:col-span-2">
              <SubmitButton>Save (override calibration)</SubmitButton>
            </div>
          </form>

          <SectionHeader title="Why these numbers" />
          <p className="max-w-2xl text-[12px] text-slate">
            Break-even MER comes from this merchant&apos;s contribution margin rate, the CAC ceiling
            from its own historical variance, and the claim-gap tolerance from what the account
            normally runs at — never a global default. A blank means the input data is absent, in
            which case the rules that depend on it stay quiet rather than firing on nothing.
          </p>
          {cal.thresholds.breakEvenMer === null ? (
            <p className="mt-2 max-w-2xl text-[12px]">
              <Absent reason="break-even MER unavailable — no cost inputs, so contribution margin can't be computed" />
            </p>
          ) : null}
        </>
      )}
    </>
  );
}
