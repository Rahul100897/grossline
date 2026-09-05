// Default backfill windows per provider. 13 months minimum everywhere; more
// where the platform allows — Meta insights totals and Google Ads history go
// back 37 months, and our own database becomes the only long history we keep.
import type { DateWindow } from './connectors/types';

export const BACKFILL_MONTHS: Record<string, number> = {
  shopify: 13,
  meta: 37,
  google_ads: 37,
};

export function backfillWindowFor(provider: string, now: Date = new Date()): DateWindow {
  const months = BACKFILL_MONTHS[provider] ?? 13;
  // End tomorrow (UTC midnight) so today's partial day is included.
  const end = new Date(
    Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() + 1),
  );
  const start = new Date(
    Date.UTC(end.getUTCFullYear(), end.getUTCMonth() - months, end.getUTCDate()),
  );
  return { start, end };
}
