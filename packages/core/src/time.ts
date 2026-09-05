// Timezone arithmetic on the platform Intl data — no dependencies.
// The reporting timezone is applied at query time only; nothing here ever
// shifts a stored timestamp (CLAUDE.md non-negotiable #5).

/** Offset of `timeZone` from UTC, in minutes, at the given instant. */
export function zoneOffsetMinutes(timeZone: string, at: Date): number {
  const dtf = new Intl.DateTimeFormat('en-US', { timeZone, timeZoneName: 'longOffset' });
  const name = dtf.formatToParts(at).find((p) => p.type === 'timeZoneName')?.value ?? 'GMT';
  const match = /GMT([+-])(\d{2}):(\d{2})/.exec(name);
  if (!match) return 0; // plain "GMT"
  const sign = match[1] === '-' ? -1 : 1;
  return sign * (Number(match[2]) * 60 + Number(match[3]));
}

/** UTC instant of a wall-clock time in `timeZone` (two-pass around DST). */
export function wallTimeToUtc(
  timeZone: string,
  year: number,
  month: number, // 1-12
  day: number,
  hour = 0,
  minute = 0,
): Date {
  const naive = Date.UTC(year, month - 1, day, hour, minute);
  let offset = zoneOffsetMinutes(timeZone, new Date(naive));
  let utc = naive - offset * 60_000;
  offset = zoneOffsetMinutes(timeZone, new Date(utc));
  utc = naive - offset * 60_000;
  return new Date(utc);
}

/** The local calendar date ('YYYY-MM-DD') of a UTC instant in `timeZone`. */
export function dateInZone(at: Date, timeZone: string): string {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(at);
}

/** '2026-08-01' → '2026-07-01' */
export function previousMonthPeriod(period: string): string {
  const [y, m] = period.split('-').map(Number) as [number, number];
  const [py, pm] = m === 1 ? [y - 1, 12] : [y, m - 1];
  return `${py}-${String(pm).padStart(2, '0')}-01`;
}

/** '2026-08-01' → '2025-08-01' */
export function yearAgoPeriod(period: string): string {
  const [y] = period.split('-').map(Number) as [number];
  return `${y - 1}${period.slice(4)}`;
}

/** The n calendar date labels ending at endDate (inclusive). */
export function lastNDates(endDate: string, n: number): string[] {
  const end = Date.parse(`${endDate}T00:00:00Z`);
  return Array.from({ length: n }, (_, i) =>
    new Date(end - (n - 1 - i) * 86_400_000).toISOString().slice(0, 10),
  );
}

export type MonthWindow = {
  /** First instant of the month in the reporting timezone, as UTC. */
  startUtc: Date;
  /** First instant of the NEXT month (half-open), as UTC. */
  endUtc: Date;
  /** Every calendar date label in the month ('YYYY-MM-DD'). */
  dateStrings: string[];
};

/**
 * The single source of truth for a reporting month's boundary. Timestamped
 * data (Shopify orders) filters by [startUtc, endUtc); platform daily rows
 * (Meta/Google, keyed by a date string in the ad account's own timezone)
 * filter by dateStrings. A platform day cannot be re-cut into another
 * timezone — it belongs to the month whose label it carries, which is a
 * known, explainable variance source for reconciliation.
 */
export function monthWindow(timeZone: string, year: number, month: number): MonthWindow {
  if (month < 1 || month > 12) throw new Error(`month out of range: ${month}`);
  const startUtc = wallTimeToUtc(timeZone, year, month, 1);
  const [nextYear, nextMonth] = month === 12 ? [year + 1, 1] : [year, month + 1];
  const endUtc = wallTimeToUtc(timeZone, nextYear, nextMonth, 1);

  const daysInMonth = new Date(Date.UTC(nextYear, nextMonth - 1, 0)).getUTCDate();
  const mm = String(month).padStart(2, '0');
  const dateStrings = Array.from(
    { length: daysInMonth },
    (_, i) => `${year}-${mm}-${String(i + 1).padStart(2, '0')}`,
  );
  return { startUtc, endUtc, dateStrings };
}
