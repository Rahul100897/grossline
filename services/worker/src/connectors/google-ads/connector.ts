import { z } from 'zod';
import {
  getConnection,
  getCredential,
  updateConnectionHealth,
  upsertRawGoogleAdsInsights,
  type GoogleAdsInsightRow,
} from '@grossline/db';
import type { Connector, DateWindow, SyncContext } from '../types';
import {
  GoogleAdsUnlinkedAccountError,
  digitsOnly,
  googleAdsCredentialsSchema,
  googleAdsSearchStream,
  type GoogleAdsCredentials,
} from './client';

/** Conversions keep restating for weeks; every incremental re-pulls this window. */
export const GOOGLE_RESTATEMENT_DAYS = 30;

export function campaignDaysQuery(start: Date, end: Date): string {
  // segments.date BETWEEN is inclusive on both ends; our windows are half-open.
  const from = start.toISOString().slice(0, 10);
  const untilInclusive = new Date(end.getTime() - 86_400_000).toISOString().slice(0, 10);
  return `
    SELECT
      campaign.id,
      campaign.name,
      campaign.advertising_channel_type,
      metrics.cost_micros,
      metrics.impressions,
      metrics.clicks,
      metrics.conversions,
      metrics.conversions_value,
      segments.date
    FROM campaign
    WHERE segments.date BETWEEN '${from}' AND '${untilInclusive}'
    ORDER BY segments.date`;
}

type LoadedContext = { creds: GoogleAdsCredentials; loginCustomerId: string };

async function loadGoogleContext(ctx: SyncContext): Promise<LoadedContext> {
  const connection = await getConnection(ctx.tenantId, ctx.connectionId);
  if (!connection) throw new Error('connection not found');
  if (!connection.credentialRef) throw new Error('google ads connection has no credential');
  const credential = await getCredential(ctx.tenantId, connection.credentialRef);
  if (!credential) throw new Error('google ads credential not found');
  const settings = (connection.settings ?? {}) as Record<string, unknown>;
  const loginCustomerId =
    (typeof settings.loginCustomerId === 'string' ? settings.loginCustomerId : null) ??
    process.env.GOOGLE_ADS_LOGIN_CUSTOMER_ID;
  if (!loginCustomerId) {
    throw new Error('no login-customer-id: set connection settings or GOOGLE_ADS_LOGIN_CUSTOMER_ID');
  }
  return {
    creds: googleAdsCredentialsSchema.parse(credential.payload),
    loginCustomerId: digitsOnly(loginCustomerId),
  };
}

const resultRowSchema = z
  .object({
    campaign: z.object({ id: z.union([z.string(), z.number()]) }).passthrough(),
    segments: z.object({ date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/) }).passthrough(),
  })
  .passthrough();

/** An unlinked account is a connection-health state, not a crash loop. */
async function markBrokenIfUnlinked(ctx: SyncContext, err: unknown): Promise<void> {
  if (err instanceof GoogleAdsUnlinkedAccountError) {
    await updateConnectionHealth(ctx.tenantId, ctx.connectionId, {
      health: 'broken',
      lastError: err.message,
    });
  }
}

async function pullCampaignDays(
  ctx: SyncContext,
  loaded: LoadedContext,
  window: DateWindow,
): Promise<number> {
  const results = await googleAdsSearchStream(
    ctx,
    loaded.creds,
    loaded.loginCustomerId,
    campaignDaysQuery(window.start, window.end),
  );
  const rows: GoogleAdsInsightRow[] = results.map((r) => {
    const parsed = resultRowSchema.parse(r);
    return {
      customerId: digitsOnly(loaded.creds.customerId),
      campaignId: String(parsed.campaign.id),
      date: parsed.segments.date,
      payload: r,
    };
  });
  return upsertRawGoogleAdsInsights(ctx.tenantId, ctx.connectionId, rows);
}

export const googleAdsConnector: Connector = {
  provider: 'google_ads',
  streams: ['campaign'],
  chunkDays: 30,

  async backfillChunk(ctx, _stream, window) {
    const loaded = await loadGoogleContext(ctx);
    try {
      const rowsWritten = await pullCampaignDays(ctx, loaded, window);
      ctx.log.info('google ads backfill chunk done', {
        start: window.start.toISOString(),
        end: window.end.toISOString(),
        rowsWritten,
      });
      return { rowsWritten };
    } catch (err) {
      await markBrokenIfUnlinked(ctx, err);
      throw err;
    }
  },

  // Not "since the last run": conversions restate for weeks, so every sync
  // re-pulls the trailing 30-day window and upserts over what it finds.
  async incremental(ctx, _since) {
    const loaded = await loadGoogleContext(ctx);
    const now = new Date();
    try {
      const rowsWritten = await pullCampaignDays(ctx, loaded, {
        start: new Date(now.getTime() - GOOGLE_RESTATEMENT_DAYS * 86_400_000),
        end: new Date(now.getTime() + 86_400_000), // include today
      });
      return { rowsWritten, newSince: now.toISOString() };
    } catch (err) {
      await markBrokenIfUnlinked(ctx, err);
      throw err;
    }
  },

  async health(ctx) {
    try {
      const loaded = await loadGoogleContext(ctx);
      await googleAdsSearchStream(
        ctx,
        loaded.creds,
        loaded.loginCustomerId,
        'SELECT customer.id FROM customer LIMIT 1',
      );
      return { healthy: true };
    } catch (err) {
      const detail = err instanceof Error ? err.message : String(err);
      await markBrokenIfUnlinked(ctx, err);
      return { healthy: false, detail };
    }
  },
};
