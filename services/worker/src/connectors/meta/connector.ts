import { z } from 'zod';
import {
  getConnection,
  getCredential,
  upsertRawMetaInsights,
  type MetaInsightRow,
} from '@grossline/db';
import type { Connector, DateWindow, SyncContext } from '../types';
import { metaCredentialsSchema, metaGet, metaGetAllPages, type MetaCredentials } from './client';

/** Meta restates recent days; every incremental re-pulls this trailing window. */
export const META_RESTATEMENT_DAYS = 28;
/** Unique metrics (reach, frequency) are only available for the last 13 months. */
const UNIQUE_METRICS_MONTHS = 13;

const BASE_FIELDS = [
  'account_id',
  'account_currency',
  'date_start',
  'date_stop',
  'spend',
  'impressions',
  'clicks',
  'actions',
  'action_values',
  'purchase_roas',
  'attribution_setting',
];
const UNIQUE_FIELDS = ['reach', 'frequency'];
const CAMPAIGN_FIELDS = ['campaign_id', 'campaign_name'];

export function insightsFieldsFor(level: 'account' | 'campaign', window: DateWindow): string[] {
  const uniqueCutoff = new Date();
  uniqueCutoff.setUTCMonth(uniqueCutoff.getUTCMonth() - UNIQUE_METRICS_MONTHS);
  const fields = [...BASE_FIELDS];
  if (window.end > uniqueCutoff) fields.push(...UNIQUE_FIELDS);
  if (level === 'campaign') fields.push(...CAMPAIGN_FIELDS);
  return fields;
}

async function loadMetaContext(ctx: SyncContext): Promise<MetaCredentials> {
  const connection = await getConnection(ctx.tenantId, ctx.connectionId);
  if (!connection) throw new Error('connection not found');
  if (!connection.credentialRef) throw new Error('meta connection has no credential');
  const credential = await getCredential(ctx.tenantId, connection.credentialRef);
  if (!credential) throw new Error('meta credential not found');
  return metaCredentialsSchema.parse(credential.payload);
}

const insightRowSchema = z
  .object({
    date_start: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
    campaign_id: z.string().optional(),
    account_id: z.string().optional(),
  })
  .passthrough();

const dateOnly = (d: Date) => d.toISOString().slice(0, 10);

async function pullInsights(
  ctx: SyncContext,
  creds: MetaCredentials,
  level: 'account' | 'campaign',
  window: DateWindow,
): Promise<number> {
  // time_range.until is inclusive; our windows are half-open, so subtract a day.
  const untilInclusive = new Date(window.end.getTime() - 86_400_000);
  const raw = await metaGetAllPages(ctx, creds, `${creds.adAccountId}/insights`, {
    level,
    time_increment: '1',
    limit: '500',
    fields: insightsFieldsFor(level, window).join(','),
    time_range: JSON.stringify({ since: dateOnly(window.start), until: dateOnly(untilInclusive) }),
  });
  const rows: MetaInsightRow[] = raw.map((r) => {
    const parsed = insightRowSchema.parse(r);
    return {
      adAccountId: creds.adAccountId,
      level,
      campaignId: level === 'campaign' ? (parsed.campaign_id ?? '') : '',
      date: parsed.date_start,
      payload: r,
    };
  });
  return upsertRawMetaInsights(ctx.tenantId, ctx.connectionId, rows);
}

export const metaConnector: Connector = {
  provider: 'meta',
  streams: ['account', 'campaign'],
  chunkDays: 30,

  async backfillChunk(ctx, stream, window) {
    const creds = await loadMetaContext(ctx);
    const level = z.enum(['account', 'campaign']).parse(stream);
    const rowsWritten = await pullInsights(ctx, creds, level, window);
    ctx.log.info('meta backfill chunk done', {
      insightsLevel: level,
      start: window.start.toISOString(),
      end: window.end.toISOString(),
      rowsWritten,
    });
    return { rowsWritten };
  },

  // Not "since the last run": Meta restates recent days, so every sync
  // re-pulls the trailing 28-day window and upserts over what it finds.
  async incremental(ctx, _since) {
    const creds = await loadMetaContext(ctx);
    const now = new Date();
    const window: DateWindow = {
      start: new Date(now.getTime() - META_RESTATEMENT_DAYS * 86_400_000),
      end: new Date(now.getTime() + 86_400_000), // include today
    };
    let rowsWritten = 0;
    for (const level of ['account', 'campaign'] as const) {
      rowsWritten += await pullInsights(ctx, creds, level, window);
    }
    return { rowsWritten, newSince: now.toISOString() };
  },

  async health(ctx) {
    try {
      const creds = await loadMetaContext(ctx);
      const info = z
        .object({ account_status: z.number() })
        .passthrough()
        .parse(await metaGet(ctx, creds, creds.adAccountId, { fields: 'account_status' }));
      // 1 = active; anything else (2 disabled, 3 unsettled, …) is not healthy.
      return info.account_status === 1
        ? { healthy: true }
        : { healthy: false, detail: `ad account status ${info.account_status}` };
    } catch (err) {
      return { healthy: false, detail: err instanceof Error ? err.message : String(err) };
    }
  },
};
