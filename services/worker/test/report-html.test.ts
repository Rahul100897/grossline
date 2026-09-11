import { describe, expect, it } from 'vitest';
import { renderReportHtml, REPORT_PDF_OPTIONS, type ReportModel } from '../src/reports/report-html';

// task 5.B1 — the pure template renders the seven fixed sections from a fully
// resolved model. Both outputs (PDF and web preview) come from this one string,
// so identical content is structural. Values are literals here; the build-model
// selection is exercised against the demo separately.
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
      reportingTimezone: 'America/New_York',
      lastSyncedAt: '2026-09-01T06:00:00.000Z',
      lastReconciledAt: '2026-09-01T07:00:00.000Z',
      provisional: false,
      costCompleteness: 0.98,
      costProvenance: 'merchant upload + Shopify',
    },
    headline: {
      sentence:
        'August 2026 worked — USD 12,500.00 of contribution after ad spend, up on last month.',
      contributionMinor: 1_250_000,
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
        { label: 'Gross sales', amountMinor: 2_000_000 },
        { label: 'Discounts', amountMinor: -140_000 },
        { label: 'Net sales', amountMinor: 1_860_000, kind: 'subtotal' },
        { label: 'Cost of goods', amountMinor: -560_000 },
        { label: 'Contribution after ad spend', amountMinor: 1_250_000, kind: 'total' },
      ],
      completeness: 0.98,
    },
    channels: [
      {
        label: 'Meta',
        spendMinor: 400_000,
        platformConversions: 120,
        storeOrders: 44,
        claimGap: 0.63,
      },
      {
        label: 'Google Ads',
        spendMinor: 300_000,
        platformConversions: 80,
        storeOrders: 60,
        claimGap: 0.25,
      },
    ],
    whatChanged: [
      { label: 'Net sales', current: 'USD 18,600.00', mom: '+USD 1,200.00', yoy: null },
      { label: 'Blended MER', current: '2.82', mom: '+0.32', yoy: '+0.40' },
    ],
    findings: [
      {
        title: 'Payback broken',
        entityLabel: 'Whole account',
        family: 'waste',
        valueLabel: 'USD 558.96 at stake',
        text: 'Blended CAC is USD 58.42 while first-order contribution is only USD 54.31.',
      },
      {
        title: 'Spend headroom',
        entityLabel: 'Whole account',
        family: 'growth',
        valueLabel: '+USD 4,508.01 opportunity',
        text: 'At today’s efficiency there is roughly USD 4,508.01 of additional monthly spend that would still clear break-even. Efficiency falls as spend rises.',
      },
      {
        title: 'Claim gap',
        entityLabel: 'Meta',
        family: 'measurement',
        valueLabel: 'no money at stake',
        text: 'Meta claims 120 conversions against 44 store-recorded orders — a measurement risk.',
      },
    ],
    nothingNeedsChanging: false,
    checksThisMonth: [
      'blended CAC against first-order contribution',
      'blended MER against break-even',
    ],
    lastMonthOutcomes: [
      {
        label: 'Payback broken · Whole account',
        result: 'blended_cac USD 64.73 → USD 54.44',
        status: 'improving',
      },
    ],
    freeReport: null,
    ...over,
  };
}

describe('report template (task 5.B1)', () => {
  it('renders the fixed sections in order, verdict first', () => {
    const html = renderReportHtml(model());
    // The verdict opens the report, ahead of the first section heading.
    const verdictIdx = html.indexOf('class="verdict"');
    expect(verdictIdx).toBeGreaterThan(-1);
    // Merchant-facing section headings (ported from docs/design/report.html).
    const sections = [
      'Did the ads pay for themselves',
      'Where the money went',
      'What each platform claims, and what your store recorded',
      'What changed since July', // prev month of 2026-08
      "What's worth changing this month",
      "What we'll check next month",
    ];
    let last = verdictIdx;
    for (const s of sections) {
      const idx = html.indexOf(`>${s}<`);
      expect(idx, `section "${s}" present`).toBeGreaterThan(-1);
      expect(idx, `section "${s}" in order`).toBeGreaterThan(last);
      last = idx;
    }
  });

  it('carries the honesty markers in the footer band', () => {
    const html = renderReportHtml(model());
    expect(html).toContain('Reported in <b>USD</b>');
    expect(html).toContain('America/New_York');
    expect(html).toContain('Checked against Shopify, Google and Meta');
    expect(html).toContain('Cost of goods covers <b>98%</b>');
    expect(html).toContain('merchant upload + Shopify');
  });

  it('shows the growth finding distinctly from waste and measurement', () => {
    const html = renderReportHtml(model());
    expect(html).toContain('Growth opportunity');
    expect(html).toContain('+USD 4,508.01 opportunity');
    expect(html).toContain('class="finding growth"');
    expect(html).toContain('USD 558.96 at stake');
    expect(html).toContain('class="finding measurement"');
  });

  it('embeds the fonts so the PDF renders offline (no network request)', () => {
    const html = renderReportHtml(model());
    expect(html).toContain("font-family:'Instrument Serif'");
    expect(html).toContain('data:font/woff2;base64,');
    expect(html).not.toContain('fonts.googleapis.com');
    expect(html).not.toContain('fonts.gstatic.com');
  });

  it('authors no colour hex in the renderer — only --gl-* tokens (bar the inlined token block)', () => {
    const html = renderReportHtml(model());
    // Strip the one legitimate hex source: the inlined :root token block.
    const withoutTokens = html.replace(/:root\{[\s\S]*?\}/, '');
    expect(withoutTokens).not.toMatch(/#[0-9a-fA-F]{6}\b/);
  });

  it('renders the margin waterfall with a negative discount and a contribution total', () => {
    const html = renderReportHtml(model());
    expect(html).toContain('Gross sales');
    expect(html).toContain('USD -1,400.00'); // discounts shown negative
    expect(html).toContain('class="total"');
  });

  it('is deterministic — the same model renders the same HTML (both outputs identical)', () => {
    expect(renderReportHtml(model())).toBe(renderReportHtml(model()));
  });

  it('shows a nothing-needs-changing banner when only measurement findings remain', () => {
    const html = renderReportHtml(
      model({
        nothingNeedsChanging: true,
        findings: [
          {
            title: 'Claim gap',
            entityLabel: 'Meta',
            family: 'measurement',
            valueLabel: 'no money at stake',
            text: 'A measurement risk to note.',
          },
        ],
        checksThisMonth: [],
      }),
    );
    expect(html).toContain('Nothing needs changing this month');
  });

  it('renders the free-first-report footer when present', () => {
    const html = renderReportHtml(
      model({ freeReport: { periodLabel: 'August 2026', priceText: 'USD 400 / month' } }),
    );
    expect(html).toContain('complimentary');
    expect(html).toContain('USD 400 / month');
  });

  // task 5.B2 — print rules that stop orphaned table headers and split rows.
  it('carries print rules that repeat table headers and keep rows/blocks whole', () => {
    const html = renderReportHtml(model());
    expect(html).toContain('@media print');
    expect(html).toContain('thead { display: table-header-group; }');
    expect(html).toContain('tr { break-inside: avoid; }');
    expect(html).toContain('.finding, .stat, .gaprow, .crow, .ch { break-inside: avoid; }');
  });

  it('report PDF options set per-page margins and a page-number footer', () => {
    expect(REPORT_PDF_OPTIONS.margin).toEqual({
      top: '14mm',
      bottom: '16mm',
      left: '14mm',
      right: '14mm',
    });
    expect(REPORT_PDF_OPTIONS.footerHtml).toContain('pageNumber');
    expect(REPORT_PDF_OPTIONS.footerHtml).toContain('totalPages');
  });
});
