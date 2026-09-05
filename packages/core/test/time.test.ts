import { describe, expect, it } from 'vitest';
import { dateInZone, monthWindow, wallTimeToUtc, zoneOffsetMinutes } from '../src/time';

describe('zoneOffsetMinutes', () => {
  it('knows fixed and DST offsets', () => {
    expect(zoneOffsetMinutes('Asia/Kolkata', new Date('2026-08-15T00:00:00Z'))).toBe(330);
    expect(zoneOffsetMinutes('America/New_York', new Date('2026-07-01T00:00:00Z'))).toBe(-240); // EDT
    expect(zoneOffsetMinutes('America/New_York', new Date('2026-01-15T00:00:00Z'))).toBe(-300); // EST
    expect(zoneOffsetMinutes('UTC', new Date('2026-01-15T00:00:00Z'))).toBe(0);
  });
});

describe('monthWindow', () => {
  it('gives the IST reporting month one boundary for both timestamped and daily data', () => {
    const window = monthWindow('Asia/Kolkata', 2026, 8);
    expect(window.startUtc.toISOString()).toBe('2026-07-31T18:30:00.000Z');
    expect(window.endUtc.toISOString()).toBe('2026-08-31T18:30:00.000Z');
    expect(window.dateStrings).toHaveLength(31);
    expect(window.dateStrings[0]).toBe('2026-08-01');
    expect(window.dateStrings.at(-1)).toBe('2026-08-31');

    // A store order at 00:30 IST on Aug 1 is inside; 23:30 IST on Jul 31 is not.
    const inside = new Date('2026-07-31T19:00:00Z'); // 00:30 IST Aug 1
    const outside = new Date('2026-07-31T18:00:00Z'); // 23:30 IST Jul 31
    expect(inside >= window.startUtc && inside < window.endUtc).toBe(true);
    expect(outside >= window.startUtc).toBe(false);

    // A USD ad account's daily row for '2026-08-01' matches the same window's
    // date labels — one boundary source for both.
    expect(window.dateStrings.includes('2026-08-01')).toBe(true);
    expect(window.dateStrings.includes('2026-07-31')).toBe(false);
  });

  it('handles a DST transition month without shifting timestamps', () => {
    const november = monthWindow('America/New_York', 2026, 11); // DST ends Nov 1
    expect(november.startUtc.toISOString()).toBe('2026-11-01T04:00:00.000Z'); // EDT
    expect(november.endUtc.toISOString()).toBe('2026-12-01T05:00:00.000Z'); // EST
  });

  it('rolls the year over for December', () => {
    const december = monthWindow('UTC', 2026, 12);
    expect(december.endUtc.toISOString()).toBe('2027-01-01T00:00:00.000Z');
  });
});

describe('wallTimeToUtc / dateInZone round trips', () => {
  it('maps wall time to the right instant and back to the right label', () => {
    const utc = wallTimeToUtc('Asia/Kolkata', 2026, 8, 1, 0, 0);
    expect(utc.toISOString()).toBe('2026-07-31T18:30:00.000Z');
    expect(dateInZone(utc, 'Asia/Kolkata')).toBe('2026-08-01');
    expect(dateInZone(new Date(utc.getTime() - 60_000), 'Asia/Kolkata')).toBe('2026-07-31');
  });
});
