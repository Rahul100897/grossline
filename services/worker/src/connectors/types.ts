import type { logger } from '@grossline/core';

/** Half-open UTC window: start inclusive, end exclusive. */
export type DateWindow = { start: Date; end: Date };

export type SyncContext = {
  tenantId: string;
  connectionId: string;
  /** Injected so tests can serve recorded fixtures; defaults to global fetch. */
  fetchImpl: typeof fetch;
  log: typeof logger;
};

export type ChunkResult = { rowsWritten: number };
export type IncrementalResult = {
  rowsWritten: number;
  /** Opaque provider watermark (e.g. an updated_at ISO string) for the next run. */
  newSince: string;
};
export type HealthResult = { healthy: boolean; detail?: string };

/**
 * The shape every provider implements. Backfill work is chunked by the engine
 * (resumable via cursors); the connector only ever sees one chunk at a time.
 */
export interface Connector {
  provider: string;
  /** Independent data streams (e.g. shopify: orders, customers, products). */
  streams: string[];
  /** Chunk size the engine slices backfill windows into. */
  chunkDays: number;
  backfillChunk(ctx: SyncContext, stream: string, window: DateWindow): Promise<ChunkResult>;
  incremental(ctx: SyncContext, since: string | null): Promise<IncrementalResult>;
  health(ctx: SyncContext): Promise<HealthResult>;
}
