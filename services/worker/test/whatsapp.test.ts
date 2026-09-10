import { describe, expect, it } from 'vitest';
import { buildWhatsAppSummary } from '../src/reports/whatsapp';
import type { ReportModel } from '../src/reports/report-html';

// task 5.B6 — a short, paste-ready block: headline, three numbers, top finding.
function model(over: Partial<ReportModel> = {}): ReportModel {
  return {
    tenantName: 'Demo Brand',
    brandText: null,
    currency: 'USD',
    period: '2026-08-01',
    periodLabel: 'August 2026',
    generatedAt: '2026-09-01T09:00:00.000Z',
    honesty: {
      reportingCurrency: 'USD',
      reportingTimezone: 'UTC',
      lastSyncedAt: null,
      lastReconciledAt: null,
      provisional: false,
      costCompleteness: 1,
      costProvenance: null,
    },
    headline: {
      sentence:
        'August 2026 worked — USD 7,810.07 of contribution after ad spend, up on last month.',
      contributionMinor: 781_007,
      direction: 'up',
    },
    efficiency: {
      merValue: 2.82,
      breakEvenMer: 1.8,
      targetMer: null,
      blendedCacMinor: 5842,
      firstOrderContributionMinor: 5431,
    },
    margin: {
      rows: [
        { label: 'Net sales', amountMinor: 1_860_000, kind: 'subtotal' },
        { label: 'Contribution after ad spend', amountMinor: 781_007, kind: 'total' },
      ],
      completeness: 1,
    },
    channels: [],
    whatChanged: [],
    findings: [
      {
        title: 'Payback broken',
        entityLabel: 'Whole account',
        family: 'waste',
        valueLabel: 'USD 558.96 at stake',
        text: '…',
      },
      {
        title: 'Spend headroom',
        entityLabel: 'Whole account',
        family: 'growth',
        valueLabel: '+USD 4,508.01 opportunity',
        text: '…',
      },
      {
        title: 'Claim gap',
        entityLabel: 'Google Ads',
        family: 'measurement',
        valueLabel: 'no money at stake',
        text: '…',
      },
    ],
    nothingNeedsChanging: false,
    checksThisMonth: [],
    lastMonthOutcomes: [],
    freeReport: null,
    ...over,
  };
}

describe('WhatsApp summary (task 5.B6)', () => {
  it('is a short block: headline, three numbers, the top finding', () => {
    const text = buildWhatsAppSummary(model());
    const lines = text.split('\n');
    expect(lines).toHaveLength(4);
    expect(lines[0]).toBe('Demo Brand — August 2026');
    expect(lines[1]).toContain('contribution after ad spend');
    expect(lines[2]).toBe(
      'MER 2.82 (break-even 1.80) · Net sales USD 18,600.00 · Contribution USD 7,810.07',
    );
    expect(lines[3]).toBe('Top: Payback broken — USD 558.96 at stake');
  });

  it('leads with a growth finding when there is no waste finding', () => {
    const text = buildWhatsAppSummary(
      model({
        findings: [
          {
            title: 'Spend headroom',
            entityLabel: 'Whole account',
            family: 'growth',
            valueLabel: '+USD 4,508.01 opportunity',
            text: '…',
          },
        ],
      }),
    );
    expect(text).toContain('Top: Spend headroom — +USD 4,508.01 opportunity');
  });

  it('says nothing-needs-changing when there is no actionable finding', () => {
    const text = buildWhatsAppSummary(
      model({
        nothingNeedsChanging: true,
        findings: [
          {
            title: 'Claim gap',
            entityLabel: 'Google Ads',
            family: 'measurement',
            valueLabel: 'no money at stake',
            text: '…',
          },
        ],
      }),
    );
    expect(text).toContain('Nothing needs changing this month.');
  });
});
