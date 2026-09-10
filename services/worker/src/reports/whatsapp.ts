// WhatsApp summary block (docs/phase-5.md task B6). Plain text, ready to paste,
// short enough for a phone: headline, three numbers, the top finding in one
// line. Not an integration — the console offers this as a copy button. Pure and
// golden-tested; built from the report snapshot so it says exactly what the
// report says.
import { minorUnitExponent } from '@grossline/core';
import type { ReportModel } from './report-html';

function money(minor: number | null, currency: string): string {
  if (minor === null) return '—';
  const exp = minorUnitExponent(currency);
  return `${currency} ${(minor / 10 ** exp).toLocaleString('en-US', { minimumFractionDigits: exp, maximumFractionDigits: exp })}`;
}

export function buildWhatsAppSummary(m: ReportModel): string {
  const c = m.currency;
  const netRow = m.margin.rows.find((r) => r.label === 'Net sales');
  const mer = m.efficiency.merValue;
  const be = m.efficiency.breakEvenMer;
  const merLine =
    mer === null
      ? 'MER —'
      : `MER ${mer.toFixed(2)}${be === null ? '' : ` (break-even ${be.toFixed(2)})`}`;

  // The top surfaced finding (waste or growth); measurement notes don't lead.
  const top = m.findings.find((f) => f.family !== 'measurement');
  const topLine = top
    ? `Top: ${top.title} — ${top.valueLabel}`
    : m.nothingNeedsChanging
      ? 'Nothing needs changing this month.'
      : '';

  const lines = [
    `${m.tenantName} — ${m.periodLabel}`,
    m.headline.sentence,
    `${merLine} · Net sales ${money(netRow?.amountMinor ?? null, c)} · Contribution ${money(m.headline.contributionMinor, c)}`,
  ];
  if (topLine) lines.push(topLine);
  return lines.join('\n');
}
