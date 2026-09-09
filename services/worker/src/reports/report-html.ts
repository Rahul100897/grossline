// The monthly report template (docs/phase-5.md task B1). A pure function from a
// fully-resolved ReportModel to a self-contained HTML string — no database, no
// network, no Playwright, so it is testable from literals and renders
// identically to the PDF (via the shared htmlToPdf) and to the web preview.
//
// The model IS the snapshot (task B3): everything the report says is a value in
// here, never a live query at render time, so a past report re-renders
// identically after a definition change or a cost re-upload.
//
// Fixed section order, every report, every client (consistency is the product):
//   1 Headline · 2 Blended efficiency · 3 Margin · 4 Channel & claim gap
//   5 What changed · 6 Findings · 7 What we check next month
import { minorUnitExponent } from '@grossline/core';

export type Direction = 'up' | 'down' | 'flat';

/** Honesty markers that travel with the report, not just the console (B1). */
export type ReportHonesty = {
  reportingCurrency: string;
  reportingTimezone: string;
  lastSyncedAt: string | null;
  lastReconciledAt: string | null;
  /** True when the period includes provisional (not-yet-final) days. */
  provisional: boolean;
  /** Cost completeness 0..1 for the margin section, or null when unknown. */
  costCompleteness: number | null;
  /** How the costs were sourced, e.g. "merchant upload + Shopify". */
  costProvenance: string | null;
};

export type WaterfallRow = { label: string; amountMinor: number | null; kind?: 'subtotal' | 'total' };

export type ChannelRow = {
  label: string;
  spendMinor: number | null;
  platformConversions: number | null;
  storeOrders: number | null;
  claimGap: number | null; // 0..1, the divergence (measurement, not a correction)
};

export type ChangeRow = {
  label: string;
  current: string; // pre-formatted in the metric's own units
  mom: string | null; // pre-formatted delta, null = no base period
  yoy: string | null; // pre-formatted delta, null = no year-ago period
};

export type ReportFindingKind = 'waste' | 'growth' | 'measurement';

export type ReportFinding = {
  title: string;
  entityLabel: string;
  family: ReportFindingKind;
  /** Pre-formatted value line, e.g. "USD 558.96 at stake" / "+USD 4,508.01 opportunity". */
  valueLabel: string;
  /** The four-part client note (approved final → draft → template). */
  text: string;
};

export type CheckOutcome = { label: string; result: string; status: string };

export type ReportModel = {
  tenantName: string;
  /** Optional wordmark shown where a logo would go; no image is embedded. */
  brandText: string | null;
  currency: string;
  period: string; // YYYY-MM-01
  periodLabel: string; // "August 2026"
  generatedAt: string; // ISO
  honesty: ReportHonesty;

  headline: { sentence: string; contributionMinor: number | null; direction: Direction | null };

  efficiency: {
    merValue: number | null;
    breakEvenMer: number | null;
    targetMer: number | null;
    blendedCacMinor: number | null;
    firstOrderContributionMinor: number | null;
  };

  margin: { rows: WaterfallRow[]; completeness: number | null };

  channels: ChannelRow[];

  whatChanged: ChangeRow[];

  findings: ReportFinding[];
  nothingNeedsChanging: boolean;

  checksThisMonth: string[];
  lastMonthOutcomes: CheckOutcome[];

  /** Trial footer (task B7): which period is free and the price afterwards. */
  freeReport: { periodLabel: string; priceText: string } | null;
};

// ---- formatting helpers (mirrors invoice-html.ts) ----

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function money(minor: number | null, currency: string): string {
  if (minor === null) return '—';
  const exp = minorUnitExponent(currency);
  const formatted = (minor / 10 ** exp).toLocaleString('en-US', {
    minimumFractionDigits: exp,
    maximumFractionDigits: exp,
  });
  return `${currency} ${formatted}`;
}

function pct(rate: number | null, digits = 1): string {
  if (rate === null) return '—';
  return `${(rate * 100).toFixed(digits)}%`;
}

function ratio(v: number | null): string {
  if (v === null) return '—';
  return v.toFixed(2);
}

function formatDateTime(iso: string | null): string {
  if (iso === null) return 'never';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '—';
  return d.toLocaleString('en-GB', {
    day: 'numeric',
    month: 'short',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
    timeZone: 'UTC',
  });
}

const familyBadgeText: Record<ReportFindingKind, string> = {
  waste: 'Opportunity to recover',
  growth: 'Growth opportunity',
  measurement: 'Measurement note',
};

// ---- section renderers ----

function honestyBar(h: ReportHonesty): string {
  const items: string[] = [
    `Currency ${escapeHtml(h.reportingCurrency)}`,
    `Timezone ${escapeHtml(h.reportingTimezone)}`,
    `Last synced ${formatDateTime(h.lastSyncedAt)}`,
    `Last reconciled ${formatDateTime(h.lastReconciledAt)}`,
  ];
  if (h.provisional) items.push('Includes provisional days');
  if (h.costCompleteness !== null) items.push(`Cost completeness ${pct(h.costCompleteness, 0)}`);
  if (h.costProvenance) items.push(`Costs: ${escapeHtml(h.costProvenance)}`);
  return `<div class="honesty">${items.map((i) => `<span>${i}</span>`).join('<span class="sep">·</span>')}</div>`;
}

function efficiencySection(m: ReportModel): string {
  const e = m.efficiency;
  const cards = [
    { label: 'Blended MER', value: ratio(e.merValue), sub: `break-even ${ratio(e.breakEvenMer)}${e.targetMer !== null ? ` · target ${ratio(e.targetMer)}` : ''}` },
    { label: 'Blended CAC', value: money(e.blendedCacMinor, m.currency), sub: `first-order contribution ${money(e.firstOrderContributionMinor, m.currency)}` },
  ];
  return `
  <section class="block">
    <h2>Blended efficiency</h2>
    <div class="cards">
      ${cards
        .map(
          (c) => `<div class="card"><div class="card-label">${c.label}</div><div class="card-value">${c.value}</div><div class="card-sub">${c.sub}</div></div>`,
        )
        .join('')}
    </div>
  </section>`;
}

function marginSection(m: ReportModel): string {
  const rows = m.margin.rows
    .map((r) => {
      const cls = r.kind === 'total' ? ' class="total"' : r.kind === 'subtotal' ? ' class="subtotal"' : '';
      return `<tr${cls}><td>${escapeHtml(r.label)}</td><td class="num">${money(r.amountMinor, m.currency)}</td></tr>`;
    })
    .join('');
  const completeness =
    m.margin.completeness === null
      ? 'Cost completeness unknown.'
      : `Cost completeness ${pct(m.margin.completeness, 0)}${m.margin.completeness < 1 ? ' — margin below is a floor; missing costs would only reduce it.' : '.'}`;
  return `
  <section class="block">
    <h2>Margin</h2>
    <table class="waterfall">
      <tbody>${rows}</tbody>
    </table>
    <p class="note-line">${completeness}</p>
  </section>`;
}

function channelSection(m: ReportModel): string {
  if (m.channels.length === 0) {
    return `
  <section class="block">
    <h2>Channel &amp; claim gap</h2>
    <p class="empty">No ad-platform data for this period.</p>
  </section>`;
  }
  const rows = m.channels
    .map(
      (c) => `<tr>
        <td>${escapeHtml(c.label)}</td>
        <td class="num">${money(c.spendMinor, m.currency)}</td>
        <td class="num">${c.platformConversions === null ? '—' : c.platformConversions.toLocaleString('en-US')}</td>
        <td class="num">${c.storeOrders === null ? '—' : c.storeOrders.toLocaleString('en-US')}</td>
        <td class="num">${pct(c.claimGap)}</td>
      </tr>`,
    )
    .join('');
  return `
  <section class="block">
    <h2>Channel &amp; claim gap</h2>
    <table class="grid">
      <thead><tr><th>Platform</th><th class="num">Spend</th><th class="num">Platform-claimed</th><th class="num">Store-recorded</th><th class="num">Claim gap</th></tr></thead>
      <tbody>${rows}</tbody>
    </table>
    <p class="note-line">The claim gap is a measurement difference, not a correction: platforms count conversions their own way. Decisions use store-recorded orders.</p>
  </section>`;
}

function whatChangedSection(m: ReportModel): string {
  if (m.whatChanged.length === 0) {
    return `
  <section class="block">
    <h2>What changed</h2>
    <p class="empty">Not enough history yet to compare.</p>
  </section>`;
  }
  const rows = m.whatChanged
    .map(
      (r) => `<tr>
        <td>${escapeHtml(r.label)}</td>
        <td class="num">${escapeHtml(r.current)}</td>
        <td class="num">${r.mom === null ? '<span class="muted">no base</span>' : escapeHtml(r.mom)}</td>
        <td class="num">${r.yoy === null ? '<span class="muted">no base</span>' : escapeHtml(r.yoy)}</td>
      </tr>`,
    )
    .join('');
  return `
  <section class="block">
    <h2>What changed</h2>
    <table class="grid">
      <thead><tr><th>Metric</th><th class="num">This month</th><th class="num">MoM</th><th class="num">YoY</th></tr></thead>
      <tbody>${rows}</tbody>
    </table>
  </section>`;
}

function findingsSection(m: ReportModel): string {
  if (m.nothingNeedsChanging && m.findings.every((f) => f.family === 'measurement')) {
    const measurement = m.findings
      .map((f) => `<div class="finding measurement"><div class="finding-head"><span class="finding-title">${escapeHtml(f.title)}</span><span class="finding-badge">${familyBadgeText[f.family]}</span></div><p>${escapeHtml(f.text)}</p></div>`)
      .join('');
    return `
  <section class="block">
    <h2>Findings</h2>
    <div class="good-banner">Nothing needs changing this month — spend was efficient and margins held.</div>
    ${measurement}
  </section>`;
  }
  const cards = m.findings
    .map(
      (f) => `<div class="finding ${f.family}">
        <div class="finding-head">
          <span class="finding-title">${escapeHtml(f.title)}</span>
          <span class="finding-entity">${escapeHtml(f.entityLabel)}</span>
          <span class="finding-badge">${familyBadgeText[f.family]}</span>
          <span class="finding-value">${escapeHtml(f.valueLabel)}</span>
        </div>
        <p>${escapeHtml(f.text)}</p>
      </div>`,
    )
    .join('');
  return `
  <section class="block">
    <h2>Findings</h2>
    ${cards}
  </section>`;
}

function checksSection(m: ReportModel): string {
  const thisMonth =
    m.checksThisMonth.length === 0
      ? '<p class="empty">No checks carried into next month.</p>'
      : `<ul class="checks">${m.checksThisMonth.map((c) => `<li>${escapeHtml(c)}</li>`).join('')}</ul>`;
  const last =
    m.lastMonthOutcomes.length === 0
      ? ''
      : `<h3>How last month's checks turned out</h3>
         <table class="grid"><thead><tr><th>Recommendation</th><th>Result</th><th>Status</th></tr></thead>
         <tbody>${m.lastMonthOutcomes
           .map((o) => `<tr><td>${escapeHtml(o.label)}</td><td>${escapeHtml(o.result)}</td><td>${escapeHtml(o.status)}</td></tr>`)
           .join('')}</tbody></table>`;
  return `
  <section class="block">
    <h2>What we check next month</h2>
    ${thisMonth}
    ${last}
  </section>`;
}

export function renderReportHtml(m: ReportModel): string {
  const dir = m.headline.direction;
  const dirMark = dir === 'up' ? '▲' : dir === 'down' ? '▼' : dir === 'flat' ? '▬' : '';
  const footer = m.freeReport
    ? `<div class="free-note">Your ${escapeHtml(m.freeReport.periodLabel)} report is complimentary — the first is free. After that, ${escapeHtml(m.freeReport.priceText)}.</div>`
    : '';

  return `<!doctype html>
<html>
<head>
<meta charset="utf-8">
<title>${escapeHtml(m.tenantName)} — ${escapeHtml(m.periodLabel)}</title>
<style>
  :root { --ink:#14181F; --slate:#5C6470; --hair:#E6E5DF; --paper:#FFFFFF; --soft:#FAFAF7; --good:#1F7A4D; --good-soft:#EAF5EF; --attn:#B4531A; --growth:#1F7A4D; }
  * { box-sizing: border-box; }
  body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif; color: var(--ink); font-size: 12px; margin: 0; padding: 40px; font-variant-numeric: tabular-nums; }
  h1 { font-size: 22px; margin: 0 0 2px; letter-spacing: -0.01em; }
  h2 { font-size: 13px; text-transform: uppercase; letter-spacing: 0.06em; color: var(--slate); margin: 0 0 8px; border-bottom: 1px solid var(--ink); padding-bottom: 4px; }
  h3 { font-size: 12px; margin: 14px 0 6px; }
  .muted { color: var(--slate); }
  .head { display: flex; justify-content: space-between; align-items: flex-start; margin-bottom: 6px; }
  .brand { text-align: right; font-weight: 600; }
  .honesty { font-size: 10px; color: var(--slate); margin-bottom: 20px; padding-bottom: 8px; border-bottom: 1px solid var(--hair); }
  .honesty .sep { margin: 0 6px; }
  .block { margin-bottom: 22px; }
  .headline { font-size: 15px; line-height: 1.4; }
  .headline .dir { font-weight: 600; }
  .cards { display: flex; gap: 12px; }
  .card { flex: 1; border: 1px solid var(--hair); border-radius: 4px; padding: 10px 12px; background: var(--soft); }
  .card-label { font-size: 10px; text-transform: uppercase; letter-spacing: 0.06em; color: var(--slate); }
  .card-value { font-size: 20px; font-weight: 600; margin: 2px 0; }
  .card-sub { font-size: 11px; color: var(--slate); }
  table { width: 100%; border-collapse: collapse; }
  .num { text-align: right; }
  th { text-align: left; font-size: 10px; text-transform: uppercase; letter-spacing: 0.06em; color: var(--slate); border-bottom: 1px solid var(--ink); padding: 6px 8px 6px 0; }
  td { padding: 7px 8px 7px 0; border-bottom: 1px solid var(--hair); }
  .waterfall td { border-bottom: 1px dotted var(--hair); }
  .waterfall .subtotal td { font-weight: 600; border-bottom: 1px solid var(--slate); }
  .waterfall .total td { font-weight: 600; border-top: 2px solid var(--ink); border-bottom: none; }
  .note-line { font-size: 11px; color: var(--slate); margin: 8px 0 0; }
  .empty { font-size: 12px; color: var(--slate); font-style: italic; }
  .finding { border: 1px solid var(--hair); border-radius: 4px; padding: 10px 12px; margin-bottom: 8px; }
  .finding.growth { border-left: 3px solid var(--growth); }
  .finding.measurement { border-left: 3px solid var(--slate); }
  .finding.waste { border-left: 3px solid var(--attn); }
  .finding-head { display: flex; align-items: baseline; gap: 8px; margin-bottom: 4px; flex-wrap: wrap; }
  .finding-title { font-weight: 600; }
  .finding-entity { font-size: 11px; color: var(--slate); }
  .finding-badge { font-size: 10px; text-transform: uppercase; letter-spacing: 0.04em; color: var(--slate); border: 1px solid var(--hair); border-radius: 3px; padding: 0 5px; }
  .finding-value { margin-left: auto; font-weight: 600; }
  .finding p { margin: 0; line-height: 1.5; }
  .good-banner { background: var(--good-soft); border: 1px solid var(--good); color: var(--good); border-radius: 4px; padding: 10px 12px; margin-bottom: 8px; }
  .checks { margin: 0; padding-left: 18px; }
  .checks li { margin: 3px 0; }
  .free-note { margin-top: 24px; padding: 12px 14px; background: var(--soft); border: 1px solid var(--hair); border-radius: 4px; font-size: 11px; color: var(--slate); }
  .foot { margin-top: 28px; padding-top: 10px; border-top: 1px solid var(--hair); font-size: 10px; color: var(--slate); }

  /* Print: keep tables and findings whole; repeat table headers across pages. */
  @media print {
    body { padding: 0; }
    thead { display: table-header-group; }
    tr { break-inside: avoid; }
    .block, .finding, .card { break-inside: avoid; }
    h2 { break-after: avoid; }
  }
</style>
</head>
<body>
  <div class="head">
    <div>
      <h1>${escapeHtml(m.tenantName)}</h1>
      <div class="muted">Monthly report · ${escapeHtml(m.periodLabel)}</div>
    </div>
    <div class="brand">${m.brandText ? escapeHtml(m.brandText) : 'Grossline'}</div>
  </div>
  ${honestyBar(m.honesty)}

  <section class="block">
    <h2>Headline</h2>
    <p class="headline"><span class="dir">${dirMark}</span> ${escapeHtml(m.headline.sentence)}</p>
  </section>

  ${efficiencySection(m)}
  ${marginSection(m)}
  ${channelSection(m)}
  ${whatChangedSection(m)}
  ${findingsSection(m)}
  ${checksSection(m)}
  ${footer}

  <div class="foot">Generated ${formatDateTime(m.generatedAt)} UTC · figures as reported for ${escapeHtml(m.periodLabel)} in ${escapeHtml(m.currency)}.</div>
</body>
</html>`;
}
