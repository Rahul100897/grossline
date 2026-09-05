// The resumable sync engine. Backfills are sliced into chunks; the cursor for
// a stream advances only after that chunk's rows have committed, so an
// interrupted backfill resumes at the next chunk and produces exactly the rows
// an uninterrupted run would have.
import { getBackfillProgress, getCursor, markBackfillComplete, setCursor } from '@grossline/db';
import type { Connector, DateWindow, SyncContext } from './types';

type BackfillStreamCursor = { completedThrough: string };
type BackfillMetaCursor = { windowStart: string; windowEnd: string; startedAt: string };
type IncrementalCursor = { since: string };

export const BACKFILL_META_STREAM = 'backfill';

export function chunkWindow(window: DateWindow, chunkDays: number): DateWindow[] {
  if (window.end <= window.start) return [];
  const chunks: DateWindow[] = [];
  let cursor = window.start;
  while (cursor < window.end) {
    const next = new Date(cursor.getTime() + chunkDays * 86_400_000);
    chunks.push({ start: cursor, end: next < window.end ? next : window.end });
    cursor = next;
  }
  return chunks;
}

export type BackfillSummary = {
  rowsWritten: number;
  chunksRun: number;
  chunksSkipped: number;
};

export async function runBackfill(
  ctx: SyncContext,
  connector: Connector,
  window: DateWindow,
): Promise<BackfillSummary> {
  const meta = await getCursor<BackfillMetaCursor>(ctx.tenantId, ctx.connectionId, BACKFILL_META_STREAM);
  if (!meta) {
    await setCursor(ctx.tenantId, ctx.connectionId, BACKFILL_META_STREAM, {
      windowStart: window.start.toISOString(),
      windowEnd: window.end.toISOString(),
      startedAt: new Date().toISOString(),
    } satisfies BackfillMetaCursor);
  } else if (meta.windowStart !== window.start.toISOString() || meta.windowEnd !== window.end.toISOString()) {
    throw new Error(
      'backfill window differs from the in-progress one; clear cursors to restart with a new window',
    );
  }

  const summary: BackfillSummary = { rowsWritten: 0, chunksRun: 0, chunksSkipped: 0 };
  for (const stream of connector.streams) {
    const cursorKey = `backfill:${stream}`;
    const existing = await getCursor<BackfillStreamCursor>(ctx.tenantId, ctx.connectionId, cursorKey);
    const completedThrough = existing ? new Date(existing.completedThrough) : null;

    for (const chunk of chunkWindow(window, connector.chunkDays)) {
      if (completedThrough && chunk.end <= completedThrough) {
        summary.chunksSkipped++;
        continue;
      }
      const result = await connector.backfillChunk(ctx, stream, chunk);
      summary.rowsWritten += result.rowsWritten;
      summary.chunksRun++;
      await setCursor(ctx.tenantId, ctx.connectionId, cursorKey, {
        completedThrough: chunk.end.toISOString(),
      } satisfies BackfillStreamCursor);
    }
  }
  await markBackfillComplete(ctx.tenantId, ctx.connectionId);
  return summary;
}

export async function runIncremental(
  ctx: SyncContext,
  connector: Connector,
): Promise<{ rowsWritten: number }> {
  const cursor = await getCursor<IncrementalCursor>(ctx.tenantId, ctx.connectionId, 'incremental');
  const result = await connector.incremental(ctx, cursor?.since ?? null);
  await setCursor(ctx.tenantId, ctx.connectionId, 'incremental', {
    since: result.newSince,
  } satisfies IncrementalCursor);
  return { rowsWritten: result.rowsWritten };
}

/** Fraction of the backfill window completed, per stream, for progress UI. */
export async function backfillProgress(
  ctx: Pick<SyncContext, 'tenantId' | 'connectionId'>,
  connector: Pick<Connector, 'streams'>,
): Promise<{ overall: number; byStream: Record<string, number> }> {
  return getBackfillProgress(ctx.tenantId, ctx.connectionId, connector.streams);
}
