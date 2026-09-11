// The monthly report template (docs/phase-5.md task B1), ported to the design
// system from docs/design/report.html (design port, Step C). A pure function
// from a fully-resolved ReportModel to a self-contained HTML string — no
// database, no network, no Playwright, so it is testable from literals and
// renders identically to the PDF (via the shared htmlToPdf) and to the web
// preview.
//
// The model IS the snapshot (task B3): everything the report says is a value in
// here, never a live query at render time, so a past report re-renders
// identically after a definition change or a cost re-upload.
//
// Design-port rules: every colour is a --gl-* token (docs/design/design-tokens.css,
// inlined verbatim from report-assets.generated.ts — no hex is authored here);
// Instrument Serif is used only for headings and figures that carry meaning; the
// self-hosted fonts are embedded as base64 so the PDF renders identically
// offline. Values (padding, radii, type sizes) are copied verbatim from the
// mockup CSS.
//
// Fixed section order, every report, every client (consistency is the product):
//   Verdict · Efficiency · Money · Channels · What changed · Findings · What next
import { minorUnitExponent } from '@grossline/core';
import {
  DESIGN_TOKENS_CSS,
  GL,
  INTER_WOFF2_BASE64,
  INSTRUMENT_SERIF_WOFF2_BASE64,
} from './report-assets.generated';

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

export type WaterfallRow = {
  label: string;
  amountMinor: number | null;
  kind?: 'subtotal' | 'total';
};

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

/**
 * PDF options for the report (task B2): per-page margins so page 2+ is also
 * inset and the footer sits in the bottom margin, plus a centred "page X / Y"
 * footer. Kept here (pure, no Playwright) so the worker and admin render paths
 * pass the identical options. The report's own @media print rule zeroes body
 * padding, deferring to these margins.
 *
 * The footer template renders in its own Chromium document and cannot read the
 * page's CSS variables, so its colour is taken from the parsed token map — the
 * one place a literal is needed, still sourced from the single tokens file.
 */
export const REPORT_PDF_OPTIONS = {
  margin: { top: '14mm', bottom: '16mm', left: '14mm', right: '14mm' },
  footerHtml:
    `<div style="font-size:8px;color:${GL['--gl-slate']};width:100%;text-align:center;padding:0 14mm;">` +
    '<span class="pageNumber"></span> / <span class="totalPages"></span></div>',
} as const;

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
  return `${v.toFixed(2)}×`;
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

function formatDate(iso: string | null): string {
  if (iso === null) return 'never';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '—';
  return d.toLocaleString('en-GB', {
    day: 'numeric',
    month: 'long',
    year: 'numeric',
    timeZone: 'UTC',
  });
}

/** "1–31 August 2026" from a YYYY-MM-01 period. */
function periodRange(period: string, label: string): string {
  const d = new Date(`${period}T00:00:00Z`);
  if (Number.isNaN(d.getTime())) return label;
  const last = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + 1, 0)).getUTCDate();
  const month = d.toLocaleString('en-GB', { month: 'long', timeZone: 'UTC' });
  return `1–${last} ${month}`;
}

/** The previous month's name, for the "What changed since …" heading. */
function previousMonthName(period: string): string {
  const d = new Date(`${period}T00:00:00Z`);
  if (Number.isNaN(d.getTime())) return 'last month';
  const prev = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() - 1, 1));
  return prev.toLocaleString('en-GB', { month: 'long', timeZone: 'UTC' });
}

/** Direction word (+/−/flat) → the up/down/neutral colour class. */
function deltaClass(delta: string | null): string {
  if (!delta) return '';
  const t = delta.trim();
  if (t.startsWith('+')) return 'up';
  if (t.startsWith('-') || t.startsWith('−')) return 'down';
  return '';
}

// The mockup uses one caption word under each stake figure; the model carries a
// full valueLabel (e.g. "USD 558.96 at stake"), so the figure shows that verbatim
// and takes its colour from the finding family. Recorded in docs/decisions.md.
const familyStakeClass: Record<ReportFindingKind, string> = {
  waste: 'down',
  growth: 'up',
  measurement: 'n',
};
const familyBadgeText: Record<ReportFindingKind, string> = {
  waste: 'Opportunity to recover',
  growth: 'Growth opportunity',
  measurement: 'Measurement note',
};
// Finding left-border tone class (mockup .finding / .warn / .good / .growth).
const familyFindingClass: Record<ReportFindingKind, string> = {
  waste: '', // default rust border
  growth: 'growth',
  measurement: 'measurement',
};

// Claim-gap tag tone. The mockup shows 9% as ok and 40% as bad; the warn band in
// between is derived from the same token palette. Recorded in docs/decisions.md.
function gapTone(gap: number | null): string {
  if (gap === null) return 'n';
  if (gap >= 0.25) return 'bad';
  if (gap >= 0.12) return 'warn';
  return 'ok';
}

// ---- section renderers ----

function verdictSection(m: ReportModel): string {
  return `
    <div class="sec">
      <p class="verdict">${escapeHtml(m.headline.sentence)}</p>
    </div>`;
}

function efficiencySection(m: ReportModel): string {
  const e = m.efficiency;

  // Track scale for the MER card: place the value and the break-even marker on a
  // 0..(target*1.25 || value*1.35) scale so the bar reads like the mockup's.
  // Derived; recorded in docs/decisions.md.
  const merScale =
    e.merValue === null ? null : (e.targetMer ?? e.merValue) * (e.targetMer !== null ? 1.25 : 1.35);
  const merFill = merScale ? Math.max(0, Math.min(100, ((e.merValue ?? 0) / merScale) * 100)) : 0;
  const merBe =
    merScale && e.breakEvenMer !== null
      ? Math.max(0, Math.min(100, (e.breakEvenMer / merScale) * 100))
      : null;
  const merDelta = m.whatChanged.find((c) => /mer/i.test(c.label))?.mom ?? null;

  // CAC card: break-even is where CAC equals the first-order contribution, so the
  // marker sits at that value and the fill is CAC as a share of it.
  const cac = e.blendedCacMinor;
  const foc = e.firstOrderContributionMinor;
  const cacFill =
    cac !== null && foc && foc > 0 ? Math.max(0, Math.min(100, (cac / foc) * 100)) : 0;
  const cacPaysOnOne = cac !== null && foc !== null && cac <= foc;

  const merTarget =
    e.targetMer !== null ? `Your target ${ratio(e.targetMer)}` : 'No target set yet';

  return `
    <div class="sec">
      <h2>Did the ads pay for themselves</h2>
      <div class="pair">
        <div class="stat">
          <div class="k">For every ${escapeHtml(m.currency)} 1 spent on ads, this came back</div>
          <div class="v">${ratio(e.merValue)}${merDelta ? ` <small class="${deltaClass(merDelta)}">${escapeHtml(merDelta)} vs ${escapeHtml(previousMonthName(m.period))}</small>` : ''}</div>
          <div class="track"><span class="fill" style="width:${merFill.toFixed(0)}%"></span>${merBe !== null ? `<span class="be" style="left:${merBe.toFixed(0)}%"></span>` : ''}</div>
          <div class="tl"><span>You break even at ${ratio(e.breakEvenMer)}</span><span>${merTarget}</span></div>
        </div>
        <div class="stat">
          <div class="k">What each new customer cost you</div>
          <div class="v">${money(cac, m.currency)}</div>
          <div class="track"><span class="fill${cacPaysOnOne ? '' : ' bad'}" style="width:${cacFill.toFixed(0)}%"></span><span class="be" style="left:100%"></span></div>
          <div class="tl"><span>Their first order brings back ${money(foc, m.currency)}</span><span class="${cacPaysOnOne ? 'up' : 'down'}">${cacPaysOnOne ? 'Pays back on order one' : 'Not yet paying back on order one'}</span></div>
        </div>
      </div>
    </div>`;
}

function marginSection(m: ReportModel): string {
  const rows = m.margin.rows
    .map((r) => {
      const cls =
        r.kind === 'total'
          ? ' class="total"'
          : r.amountMinor !== null && r.amountMinor < 0
            ? ' class="sub"'
            : '';
      const label =
        r.kind === 'subtotal' || r.kind === 'total'
          ? `<b>${escapeHtml(r.label)}</b>`
          : escapeHtml(r.label);
      const valClass = r.kind === 'total' ? 'num up' : 'num';
      const val =
        r.kind === 'subtotal' || r.kind === 'total'
          ? `<b>${money(r.amountMinor, m.currency)}</b>`
          : money(r.amountMinor, m.currency);
      return `<tr${cls}><td>${label}</td><td class="${valClass}">${val}</td></tr>`;
    })
    .join('');
  const completeness =
    m.margin.completeness === null
      ? 'Cost completeness unknown.'
      : `Cost of goods covers ${pct(m.margin.completeness, 0)} of items sold${m.margin.completeness < 1 ? ' — the figure below is a floor; missing costs would only reduce it.' : '.'}`;
  return `
    <div class="sec">
      <h2>Where the money went</h2>
      <p class="note">${completeness}</p>
      <table>
        <tbody>${rows}</tbody>
      </table>
    </div>`;
}

function channelSection(m: ReportModel): string {
  if (m.channels.length === 0) {
    return `
    <div class="sec">
      <h2>What each platform claims, and what your store recorded</h2>
      <p class="empty">No ad-platform data for this period.</p>
    </div>`;
  }
  const rows = m.channels
    .map((c) => {
      const claim =
        c.platformConversions === null && c.storeOrders === null
          ? '—'
          : c.platformConversions === null
            ? `${c.storeOrders?.toLocaleString('en-US')} orders recorded`
            : `${c.platformConversions.toLocaleString('en-US')} &rarr; ${c.storeOrders?.toLocaleString('en-US') ?? '—'} orders`;
      const gap =
        c.claimGap === null
          ? '—'
          : `<span class="tag ${gapTone(c.claimGap)}">${pct(c.claimGap, 0)}</span>`;
      return `<div class="gaprow"><span><b>${escapeHtml(c.label)}</b></span><span class="num">${money(c.spendMinor, m.currency)}</span><span class="num">${claim}</span><span class="num">${gap}</span></div>`;
    })
    .join('');
  return `
    <div class="sec">
      <h2>What each platform claims, and what your store recorded</h2>
      <div class="gapbox">
        <div class="gaprow gaphead"><span>Channel</span><span class="num">Spend</span><span class="num">Platform claims / store recorded</span><span class="num">Gap</span></div>
        ${rows}
        <div class="gapnote">Each platform counts the same orders in its own way, so their numbers can't be added together. Your store's own record is the independent check. A small gap is normal; a large one means budgets are being set on numbers that are too generous. The gap is a measurement difference, not a correction — decisions use store-recorded orders.</div>
      </div>
    </div>`;
}

function whatChangedSection(m: ReportModel): string {
  const heading = `What changed since ${escapeHtml(previousMonthName(m.period))}`;
  if (m.whatChanged.length === 0) {
    return `
    <div class="sec">
      <h2>${heading}</h2>
      <p class="empty">Not enough history yet to compare.</p>
    </div>`;
  }
  const cols = Math.min(m.whatChanged.length, 4);
  const cells = m.whatChanged
    .map((r) => {
      const delta =
        r.mom === null
          ? '<span class="muted">no base</span>'
          : `<span class="${deltaClass(r.mom)}">${escapeHtml(r.mom)}</span>`;
      return `<div class="ch"><div class="k">${escapeHtml(r.label)}</div><div class="v">${escapeHtml(r.current)}</div><div class="d">${delta}</div></div>`;
    })
    .join('');
  return `
    <div class="sec">
      <h2>${heading}</h2>
      <div class="changed" style="grid-template-columns:repeat(${cols},1fr)">${cells}</div>
    </div>`;
}

function findingCard(f: ReportFinding): string {
  const cls = familyFindingClass[f.family];
  return `
      <div class="finding${cls ? ` ${cls}` : ''}">
        <div class="fhead">
          <h3>${escapeHtml(f.title)}</h3>
          <div class="stake ${familyStakeClass[f.family]}">${escapeHtml(f.valueLabel)}</div>
        </div>
        <p>${escapeHtml(f.text)}</p>
        <div class="fmeta"><span class="tag n">${escapeHtml(f.entityLabel)}</span><span class="tag ${f.family === 'growth' ? 'ok' : f.family === 'measurement' ? 'n' : 'warn'}">${familyBadgeText[f.family]}</span></div>
      </div>`;
}

function findingsSection(m: ReportModel): string {
  if (m.nothingNeedsChanging && m.findings.every((f) => f.family === 'measurement')) {
    const measurement = m.findings.map(findingCard).join('');
    return `
    <div class="sec">
      <h2>What's worth changing this month</h2>
      <div class="goodbanner">Nothing needs changing this month — spend was efficient and margins held.</div>
      ${measurement}
    </div>`;
  }
  return `
    <div class="sec">
      <h2>What's worth changing this month</h2>
      <p class="note">Ordered by how much money is involved. Nothing else met the threshold.</p>
      ${m.findings.map(findingCard).join('')}
    </div>`;
}

function checksSection(m: ReportModel): string {
  const thisMonth =
    m.checksThisMonth.length === 0
      ? '<p class="empty">No checks carried into next month.</p>'
      : `<div class="checks">${m.checksThisMonth
          .map(
            (c) =>
              `<div class="crow"><span>${escapeHtml(c)}</span><span class="m">Watched next month</span><span><span class="tag n">Carried forward</span></span></div>`,
          )
          .join('')}</div>`;
  const last =
    m.lastMonthOutcomes.length === 0
      ? ''
      : `<h3>How last month's checks turned out</h3>
         <div class="checks">${m.lastMonthOutcomes
           .map(
             (o) =>
               `<div class="crow"><span>${escapeHtml(o.label)}</span><span class="m">${escapeHtml(o.result)}</span><span><span class="tag ${/improv|work|resolv/i.test(o.status) ? 'ok' : 'n'}">${escapeHtml(o.status)}</span></span></div>`,
           )
           .join('')}</div>`;
  return `
    <div class="sec">
      <h2>What we'll check next month</h2>
      ${thisMonth}
      ${last}
    </div>`;
}

function footerBand(m: ReportModel): string {
  const h = m.honesty;
  const cost =
    h.costCompleteness === null
      ? 'Cost of goods coverage <b>unknown</b>'
      : `Cost of goods covers <b>${pct(h.costCompleteness, 0)}</b> of items sold${h.costProvenance ? ` (${escapeHtml(h.costProvenance)})` : ''}`;
  const provisional = h.provisional
    ? 'Recent days are provisional — platforms revise them, so the last few days may still move.'
    : 'All days in this period are final.';
  const free = m.freeReport
    ? `<span>Your ${escapeHtml(m.freeReport.periodLabel)} report is complimentary — the first is free. After that, ${escapeHtml(m.freeReport.priceText)}.</span>`
    : '';
  return `
  <div class="foot">
    <div class="grid">
      <span>Data last synced <b>${formatDateTime(h.lastSyncedAt)} UTC</b></span>
      <span>Reported in <b>${escapeHtml(h.reportingCurrency)}</b> · store timezone <b>${escapeHtml(h.reportingTimezone)}</b></span>
      <span>Checked against Shopify, Google and Meta on <b>${formatDate(h.lastReconciledAt)}</b></span>
      <span>${cost}</span>
    </div>
    <div class="end">
      <span>${provisional}</span>
      <span>Every calculation on this page is defined at <b>getgrossline.com/definitions</b></span>
    </div>
    ${free ? `<div class="end">${free}</div>` : ''}
  </div>`;
}

// ---- fonts + shell ----

function fontFaces(): string {
  return `
  @font-face{font-family:'Inter';font-style:normal;font-weight:100 900;src:url(data:font/woff2;base64,${INTER_WOFF2_BASE64}) format('woff2');}
  @font-face{font-family:'Instrument Serif';font-style:normal;font-weight:400;src:url(data:font/woff2;base64,${INSTRUMENT_SERIF_WOFF2_BASE64}) format('woff2');}`;
}

function styles(): string {
  // Ported verbatim from docs/design/report.html: every colour is a --gl-* token
  // (tokens inlined above), every padding/size copied unchanged.
  return `
  ${DESIGN_TOKENS_CSS}
  ${fontFaces()}
  *{box-sizing:border-box;margin:0;padding:0}
  html{-webkit-font-smoothing:antialiased}
  body{font-family:var(--gl-font-body);background:var(--gl-cream);color:var(--gl-ink);
       font-feature-settings:"tnum" 1;line-height:1.5;padding:34px 20px}
  .serif{font-family:var(--gl-font-display);font-weight:400;letter-spacing:-.01em}

  .page{max-width:860px;margin:0 auto 30px;background:var(--gl-paper-report);border-radius:3px;
        box-shadow:var(--gl-shadow-page);overflow:hidden}
  .pad{padding:44px 56px}

  /* cover band */
  .band{background:var(--gl-green-deep);color:var(--gl-white);padding:34px 56px 30px;display:flex;
        justify-content:space-between;align-items:flex-end;gap:30px}
  .band .t{font-family:var(--gl-font-display);font-size:38px;line-height:1.05}
  .band .s{font-size:12px;letter-spacing:.16em;text-transform:uppercase;color:var(--gl-green-muted);margin-top:8px}
  .band .r{text-align:right;font-size:13px;color:var(--gl-green-muted);line-height:1.7;white-space:nowrap}
  .band .r b{display:block;color:var(--gl-white);font-weight:500;font-size:16px}

  /* verdict */
  .verdict{font-family:var(--gl-font-display);font-size:31px;line-height:1.3;letter-spacing:-.01em}
  .verdict .up{color:var(--gl-green)}
  .verdict .down{color:var(--gl-rust)}

  /* section */
  .sec{border-top:1px solid var(--gl-line);padding-top:26px;margin-top:34px}
  .sec:first-of-type{border-top:0;margin-top:0;padding-top:0}
  .sec h2{font-size:12px;letter-spacing:.14em;text-transform:uppercase;color:var(--gl-green);font-weight:600}
  .sec .note{font-size:13px;color:var(--gl-slate-2);margin-top:5px}

  /* big pair */
  .pair{display:grid;grid-template-columns:1fr 1fr;gap:26px;margin-top:20px}
  .stat{border:1px solid var(--gl-line);border-radius:11px;padding:22px 24px;background:var(--gl-white)}
  .stat .k{font-size:13px;color:var(--gl-slate)}
  .stat .v{font-family:var(--gl-font-display);font-size:44px;line-height:1;margin-top:9px;
           display:flex;align-items:baseline;gap:11px}
  .stat .v small{font-family:var(--gl-font-body);font-size:14px;font-weight:500}
  .up{color:var(--gl-green)}.down{color:var(--gl-rust)}
  .track{position:relative;height:8px;background:var(--gl-cream-2);border-radius:4px;margin-top:16px}
  .fill{position:absolute;left:0;top:0;bottom:0;border-radius:4px;background:var(--gl-green)}
  .fill.bad{background:var(--gl-rust)}
  .be{position:absolute;top:-4px;bottom:-4px;width:2px;background:var(--gl-ink);opacity:.6}
  .tl{display:flex;justify-content:space-between;font-size:11.5px;color:var(--gl-slate);margin-top:8px}

  /* waterfall */
  table{width:100%;border-collapse:collapse;margin-top:16px}
  th{text-align:left;font-size:11px;font-weight:600;letter-spacing:.08em;text-transform:uppercase;
     color:var(--gl-slate);padding:9px 0;border-bottom:1px solid var(--gl-line)}
  td{padding:11px 0;border-bottom:1px solid var(--gl-line-soft);font-size:14.5px}
  tr:last-child td{border-bottom:0}
  .num{text-align:right;font-variant-numeric:tabular-nums}
  .total td{border-top:1.5px solid var(--gl-ink);border-bottom:0;padding-top:14px;font-weight:600;font-size:16px}
  .total td.num{font-family:var(--gl-font-display);font-size:26px;font-weight:400}
  .sub td{color:var(--gl-slate)}
  .tag{display:inline-block;font-size:11px;padding:3px 8px;border-radius:5px;font-weight:500;white-space:nowrap}
  .tag.ok{background:var(--gl-green-soft);color:var(--gl-green)}
  .tag.bad{background:var(--gl-rust-soft);color:var(--gl-rust)}
  .tag.warn{background:var(--gl-gold-soft);color:var(--gl-gold)}
  .tag.n{background:var(--gl-cream-2);color:var(--gl-slate)}

  /* claim gap */
  .gapbox{margin-top:18px;border:1px solid var(--gl-line);border-radius:11px;overflow:hidden;background:var(--gl-white)}
  .gaprow{display:grid;grid-template-columns:1.1fr 1fr 1fr 90px;gap:16px;padding:15px 22px;
          border-bottom:1px solid var(--gl-line-soft);align-items:center;font-size:14.5px}
  .gaprow:last-child{border-bottom:0}
  .gaphead{background:var(--gl-cream-3);font-size:11px;letter-spacing:.08em;text-transform:uppercase;color:var(--gl-slate);font-weight:600}
  .gaprow b{font-weight:600}
  .gapnote{padding:14px 22px;background:var(--gl-cream-2);font-size:13px;color:var(--gl-slate);line-height:1.6;
           border-top:1px solid var(--gl-line)}

  /* changed */
  .changed{display:grid;grid-template-columns:repeat(4,1fr);gap:1px;background:var(--gl-line);
           border:1px solid var(--gl-line);border-radius:11px;overflow:hidden;margin-top:18px}
  .ch{background:var(--gl-white);padding:18px 20px}
  .ch .k{font-size:12.5px;color:var(--gl-slate)}
  .ch .v{font-family:var(--gl-font-display);font-size:27px;margin-top:6px;line-height:1}
  .ch .d{font-size:12.5px;margin-top:7px;font-weight:500}

  /* findings */
  .finding{border:1px solid var(--gl-line);border-left:3px solid var(--gl-rust);border-radius:0 12px 12px 0;
           padding:24px 26px;margin-top:18px;background:var(--gl-white)}
  .finding.warn{border-left-color:var(--gl-gold)}
  .finding.good{border-left-color:var(--gl-green)}
  .finding.growth{border-left-color:var(--gl-green)}
  .finding.measurement{border-left-color:var(--gl-slate)}
  .fhead{display:flex;justify-content:space-between;align-items:flex-start;gap:20px}
  .finding h3{font-family:var(--gl-font-display);font-size:23px;line-height:1.25;letter-spacing:-.01em}
  .finding p{margin-top:11px;font-size:14.5px;line-height:1.7;color:var(--gl-slate)}
  .stake{font-family:var(--gl-font-display);font-size:26px;line-height:1.1;text-align:right;max-width:210px}
  .stake.up{color:var(--gl-green)}.stake.down{color:var(--gl-rust)}.stake.n{color:var(--gl-slate)}
  .fmeta{display:flex;gap:8px;margin-top:16px;flex-wrap:wrap}

  /* good banner */
  .goodbanner{background:var(--gl-green-soft);color:var(--gl-green);border-radius:11px;
              padding:16px 20px;margin-top:18px;font-size:14.5px;font-weight:500}

  /* check next */
  .checks{margin-top:18px;border:1px solid var(--gl-line);border-radius:11px;background:var(--gl-white);overflow:hidden}
  .crow{display:grid;grid-template-columns:1fr 190px 150px;gap:16px;padding:14px 22px;
        border-bottom:1px solid var(--gl-line-soft);font-size:14.5px;align-items:center}
  .crow:last-child{border-bottom:0}
  .crow .m{color:var(--gl-slate);font-size:13.5px}

  /* footer */
  .foot{background:var(--gl-green-dark);color:var(--gl-green-muted);padding:26px 56px;font-size:12.5px;line-height:1.9}
  .foot .grid{display:grid;grid-template-columns:repeat(2,1fr);gap:8px 40px}
  .foot b{color:var(--gl-white);font-weight:500}
  .foot .end{margin-top:16px;padding-top:14px;border-top:1px solid var(--gl-green-line);display:flex;
             justify-content:space-between;gap:20px;flex-wrap:wrap}

  /* Print: the report fills the page (PDF margins do the insetting), and nothing
     splits mid-table-row, mid-finding or mid-card. Table headers repeat. */
  @media print {
    body{padding:0;background:var(--gl-white)}
    .page{max-width:none;margin:0;border-radius:0;box-shadow:none}
    thead { display: table-header-group; }
    tr { break-inside: avoid; }
    /* Keep each atomic unit whole, but let a long section flow across pages
       (avoiding a whole tall section forces big whitespace). */
    .finding, .stat, .gaprow, .crow, .ch { break-inside: avoid; }
    h2 { break-after: avoid; }
  }

  /* Narrow-screen web preview only. Scoped to \`screen\` so the A4 PDF — whose
     printable width (~688px) is below this breakpoint — always renders the
     desktop layout instead of collapsing (docs/decisions.md). */
  @media screen and (max-width:820px){
    body{padding:16px 10px}
    .pad{padding:28px 24px}
    .band{padding:26px 24px 22px;flex-direction:column;align-items:flex-start;gap:14px}
    .band .t{font-size:29px}
    .band .r{text-align:left}
    .verdict{font-size:24px}
    .pair,.changed{grid-template-columns:1fr !important}
    .gaprow{grid-template-columns:1fr 1fr;gap:8px}
    .gaphead{display:none}
    .fhead{flex-direction:column;gap:12px}
    .stake{text-align:left;max-width:none}
    .crow{grid-template-columns:1fr;gap:3px}
    .foot{padding:22px 24px}
    .foot .grid{grid-template-columns:1fr}
  }`;
}

export function renderReportHtml(m: ReportModel): string {
  const title = `${m.tenantName}${m.brandText ? ` · ${m.brandText}` : ''}`;
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<title>${escapeHtml(m.tenantName)} — ${escapeHtml(m.periodLabel)}</title>
<style>${styles()}</style>
</head>
<body>
<div class="page">
  <div class="band">
    <div>
      <div class="t">${escapeHtml(title)}</div>
      <div class="s">Monthly performance report</div>
    </div>
    <div class="r"><b>${escapeHtml(m.periodLabel)}</b>${escapeHtml(periodRange(m.period, m.periodLabel))} · ${escapeHtml(m.honesty.reportingTimezone)}<br>Reported in ${escapeHtml(m.currency)}</div>
  </div>

  <div class="pad">
    ${verdictSection(m)}
    ${efficiencySection(m)}
    ${marginSection(m)}
    ${channelSection(m)}
    ${whatChangedSection(m)}
    ${findingsSection(m)}
    ${checksSection(m)}
  </div>

  ${footerBand(m)}
</div>
</body>
</html>`;
}
