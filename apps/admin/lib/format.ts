// Number formatting for the console. The contract that matters: ABSENT STAYS
// ABSENT — these helpers return null for missing input and the UI renders the
// <Absent> words, never a zero and never a dash that reads like zero.
import { minorUnitExponent } from '@grossline/core';

export function formatMinor(minor: number | null | undefined, currency: string | null): string | null {
  if (minor === null || minor === undefined || currency === null) return null;
  const exponent = minorUnitExponent(currency);
  return new Intl.NumberFormat('en-US', {
    style: 'currency',
    currency,
    minimumFractionDigits: exponent,
    maximumFractionDigits: exponent,
  }).format(minor / 10 ** exponent);
}

export function formatCount(value: number | null | undefined): string | null {
  if (value === null || value === undefined) return null;
  return new Intl.NumberFormat('en-US').format(value);
}

/** 0.7801 → "78.0%" */
export function formatPct(rate: number | null | undefined, digits = 1): string | null {
  if (rate === null || rate === undefined || !Number.isFinite(rate)) return null;
  return `${(rate * 100).toFixed(digits)}%`;
}

/** 2.4136 → "2.41" (ratios like MER). */
export function formatRatio(value: number | null | undefined, digits = 2): string | null {
  if (value === null || value === undefined || !Number.isFinite(value)) return null;
  return value.toFixed(digits);
}

/** Signed delta with sign always shown: +4.8% / −0.22. */
export function signed(formatted: string | null, negative: boolean): string | null {
  if (formatted === null) return null;
  return negative ? `−${formatted.replace(/^-/, '')}` : `+${formatted}`;
}

export function formatDate(value: Date | string | null | undefined): string | null {
  if (!value) return null;
  const date = typeof value === 'string' ? new Date(value) : value;
  return date.toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' });
}

export function ageDays(since: Date | string | null | undefined, now = new Date()): string | null {
  if (!since) return null;
  const days = Math.floor((now.getTime() - new Date(since).getTime()) / 86_400_000);
  if (days <= 0) return 'today';
  return `${days}d`;
}
