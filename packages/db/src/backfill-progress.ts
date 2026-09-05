// Backfill progress computed from cursor rows — one implementation shared by
// the worker (logging) and the admin console (per-connection progress UI).
import { eq } from 'drizzle-orm';
import { syncCursors } from './schema';
import { withTenant } from './tenant-scope';

type BackfillMetaCursor = { windowStart: string; windowEnd: string };
type BackfillStreamCursor = { completedThrough: string };

export type BackfillProgress = {
  /** 0..1 across all streams; 0 when no backfill has started. */
  overall: number;
  byStream: Record<string, number>;
  windowStart: string | null;
  windowEnd: string | null;
};

export async function getBackfillProgress(
  tenantId: string,
  connectionId: string,
  streams: string[],
): Promise<BackfillProgress> {
  const rows = await withTenant(tenantId, (tx) =>
    tx.select().from(syncCursors).where(eq(syncCursors.connectionId, connectionId)),
  );
  const byKey = new Map(rows.map((r) => [r.stream, r.cursor]));
  const meta = byKey.get('backfill') as BackfillMetaCursor | undefined;
  if (!meta) return { overall: 0, byStream: {}, windowStart: null, windowEnd: null };

  const start = Date.parse(meta.windowStart);
  const span = Math.max(1, Date.parse(meta.windowEnd) - start);
  const byStream: Record<string, number> = {};
  for (const stream of streams) {
    const cursor = byKey.get(`backfill:${stream}`) as BackfillStreamCursor | undefined;
    const done = cursor ? Date.parse(cursor.completedThrough) - start : 0;
    byStream[stream] = Math.min(1, Math.max(0, done / span));
  }
  const values = Object.values(byStream);
  return {
    overall: values.length ? values.reduce((a, b) => a + b, 0) / values.length : 0,
    byStream,
    windowStart: meta.windowStart,
    windowEnd: meta.windowEnd,
  };
}
