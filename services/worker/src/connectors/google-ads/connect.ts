// Connect a Google Ads client account: verify access through the MCC, record
// the account's own timezone and currency, encrypt the refresh token, create
// the connection. An unlinked account still creates the connection — marked
// broken with the linking instruction — because linking is a per-account
// onboarding step, not a reason to lose the configuration.
import { z } from 'zod';
import { logger } from '@grossline/core';
import { createConnection, putCredential, updateConnectionHealth } from '@grossline/db';
import type { SyncContext } from '../types';
import {
  GoogleAdsUnlinkedAccountError,
  digitsOnly,
  googleAdsSearchStream,
} from './client';

const customerRowSchema = z
  .object({
    customer: z
      .object({
        id: z.union([z.string(), z.number()]),
        descriptiveName: z.string().optional(),
        currencyCode: z.string(),
        timeZone: z.string(),
      })
      .passthrough(),
  })
  .passthrough();

export async function connectGoogleAdsAccount(input: {
  tenantId: string;
  customerId: string;
  loginCustomerId: string;
  refreshToken: string;
  fetchImpl?: typeof fetch;
}): Promise<{ connectionId: string; linked: boolean }> {
  const ctx: SyncContext = {
    tenantId: input.tenantId,
    connectionId: 'not-yet-created',
    fetchImpl: input.fetchImpl ?? fetch,
    log: logger,
  };
  const customerId = digitsOnly(input.customerId);
  const loginCustomerId = digitsOnly(input.loginCustomerId);
  const creds = { customerId, refreshToken: input.refreshToken };

  let info: z.infer<typeof customerRowSchema> | null = null;
  let linkError: GoogleAdsUnlinkedAccountError | null = null;
  try {
    const rows = await googleAdsSearchStream(
      ctx,
      creds,
      loginCustomerId,
      'SELECT customer.id, customer.descriptive_name, customer.currency_code, customer.time_zone FROM customer',
    );
    if (rows.length === 0) throw new Error('customer query returned no rows');
    info = customerRowSchema.parse(rows[0]);
  } catch (err) {
    if (!(err instanceof GoogleAdsUnlinkedAccountError)) throw err;
    linkError = err;
  }

  const credentialRef = await putCredential(input.tenantId, 'google_ads', {
    customerId,
    refreshToken: input.refreshToken,
  });

  const connection = await createConnection({
    tenantId: input.tenantId,
    provider: 'google_ads',
    externalAccountId: customerId,
    credentialRef,
    accountTimezone: info?.customer.timeZone,
    accountCurrency: info?.customer.currencyCode,
    settings: { loginCustomerId, accountName: info?.customer.descriptiveName ?? null },
  });

  if (linkError) {
    await updateConnectionHealth(input.tenantId, connection.id, {
      health: 'broken',
      lastError: linkError.message,
    });
    logger.warn('google ads account connected but NOT linked to the MCC yet', {
      tenantId: input.tenantId,
      customerId,
    });
    return { connectionId: connection.id, linked: false };
  }

  logger.info('google ads account connected', {
    tenantId: input.tenantId,
    customerId,
    timezone: info?.customer.timeZone,
    currency: info?.customer.currencyCode,
  });
  return { connectionId: connection.id, linked: true };
}
