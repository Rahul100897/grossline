// Connect a Meta ad account: verify the token, record the account's own
// timezone, billing currency and attribution setting on the connection
// (a ROAS figure is meaningless without the window it came from), encrypt
// the token, create the connection.
import { z } from 'zod';
import { logger } from '@grossline/core';
import { createConnection, putCredential } from '@grossline/db';
import type { SyncContext } from '../types';
import { metaGet } from './client';

const accountInfoSchema = z
  .object({
    id: z.string(),
    name: z.string(),
    currency: z.string(),
    timezone_name: z.string(),
    account_status: z.number(),
    attribution_spec: z
      .array(z.object({ event_type: z.string(), window_days: z.number() }).passthrough())
      .optional(),
  })
  .passthrough();

export async function connectMetaAccount(input: {
  tenantId: string;
  adAccountId: string; // act_<numeric>
  accessToken: string;
  fetchImpl?: typeof fetch;
}): Promise<{ connectionId: string }> {
  const ctx: SyncContext = {
    tenantId: input.tenantId,
    connectionId: 'not-yet-created',
    fetchImpl: input.fetchImpl ?? fetch,
    log: logger,
  };
  const creds = { adAccountId: input.adAccountId, accessToken: input.accessToken };

  const info = accountInfoSchema.parse(
    await metaGet(ctx, creds, input.adAccountId, {
      fields: 'id,name,currency,timezone_name,account_status,attribution_spec',
    }),
  );

  const credentialRef = await putCredential(input.tenantId, 'meta', {
    adAccountId: input.adAccountId,
    accessToken: input.accessToken,
  });

  const connection = await createConnection({
    tenantId: input.tenantId,
    provider: 'meta',
    externalAccountId: input.adAccountId,
    credentialRef,
    accountTimezone: info.timezone_name,
    accountCurrency: info.currency,
    settings: {
      attributionSpec: info.attribution_spec ?? null,
      accountStatus: info.account_status,
      accountName: info.name,
    },
  });

  logger.info('meta ad account connected', {
    tenantId: input.tenantId,
    adAccountId: input.adAccountId,
    timezone: info.timezone_name,
    currency: info.currency,
  });
  return { connectionId: connection.id };
}
