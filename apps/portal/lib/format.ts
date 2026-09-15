import { minorUnitExponent } from '@grossline/core';

export function money(minor: number | null, currency: string): string {
  if (minor === null) return '—';
  const exp = minorUnitExponent(currency);
  return `${currency} ${(minor / 10 ** exp).toLocaleString('en-US', {
    minimumFractionDigits: exp,
    maximumFractionDigits: exp,
  })}`;
}

export function count(n: number | null): string {
  return n === null ? '—' : n.toLocaleString('en-US');
}

export function pct(rate: number | null, digits = 1): string {
  return rate === null ? '—' : `${(rate * 100).toFixed(digits)}%`;
}

export function ratio(v: number | null): string {
  return v === null ? '—' : `${v.toFixed(2)}×`;
}

const MONTHS = [
  'January',
  'February',
  'March',
  'April',
  'May',
  'June',
  'July',
  'August',
  'September',
  'October',
  'November',
  'December',
];
export function monthLabel(period: string): string {
  const [y, m] = period.split('-');
  return `${MONTHS[Number(m) - 1]} ${y}`;
}
