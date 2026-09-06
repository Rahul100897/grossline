'use server';

import { redirect } from 'next/navigation';
import { z } from 'zod';
import {
  SHOPIFY_OAUTH_SCOPES,
  buildShopifyInstallUrl,
  createSessionToken,
} from '@grossline/core';
import { writeAuditLog } from '@grossline/db';
import { connectShopifyStore } from '@grossline/worker/shopify-connect';
import { requireSession, sessionSecret } from '../../../../../lib/auth';

const formSchema = z.object({
  tenantId: z.string().uuid(),
  shopDomain: z
    .string()
    .min(4)
    .regex(/^[a-z0-9][a-z0-9-]*\.myshopify\.com$/, 'use the myshopify.com domain'),
  strategy: z.enum(['legacy_static', 'client_credentials', 'authorization_code']),
  accessToken: z.string(),
  clientId: z.string(),
  clientSecret: z.string(),
});

/**
 * Same three strategies as the worker CLI. Credential fields left blank fall
 * back to the environment (SHOPIFY_STORE_TOKEN / SHOPIFY_CLIENT_ID /
 * SHOPIFY_CLIENT_SECRET) so connecting our own dev store never means pasting
 * a secret into a browser form. redirect() throws internally, so every path
 * computes its destination first and redirects outside try/catch.
 */
export async function connectStore(formData: FormData): Promise<void> {
  const session = await requireSession();
  const field = (name: string): string => String(formData.get(name) ?? '').trim();
  const tenantId = field('tenantId');
  const back = `/merchants/${tenantId}/connections`;
  const errorUrl = (message: string): string => `${back}?error=${encodeURIComponent(message)}`;

  const parsed = formSchema.safeParse({
    tenantId,
    shopDomain: field('shopDomain').toLowerCase(),
    strategy: field('strategy'),
    accessToken: field('accessToken'),
    clientId: field('clientId'),
    clientSecret: field('clientSecret'),
  });
  if (!parsed.success) {
    redirect(errorUrl(parsed.error.issues[0]?.message ?? 'invalid input'));
  }
  const data = parsed.data;

  if (data.strategy === 'authorization_code') {
    const clientId =
      data.clientId || process.env.SHOPIFY_CLIENT_ID || process.env.SHOPIFY_API_KEY || '';
    if (!clientId) {
      redirect(errorUrl('authorization_code needs a client id (or SHOPIFY_CLIENT_ID in env)'));
    }
    const redirectUri =
      process.env.SHOPIFY_REDIRECT_URI ?? 'http://localhost:3000/api/shopify/callback';
    const state = await createSessionToken(
      { sub: data.tenantId, exp: Date.now() + 60 * 60_000 },
      sessionSecret(),
    );
    const url = buildShopifyInstallUrl({
      shopDomain: data.shopDomain,
      clientId,
      scopes: SHOPIFY_OAUTH_SCOPES,
      redirectUri,
      state,
    });
    redirect(`${back}?installUrl=${encodeURIComponent(url)}`);
  }

  let input:
    | { strategy: 'legacy_static'; accessToken: string }
    | { strategy: 'client_credentials'; clientId: string; clientSecret: string };
  if (data.strategy === 'legacy_static') {
    const accessToken = data.accessToken || process.env.SHOPIFY_STORE_TOKEN || '';
    if (!accessToken) {
      redirect(errorUrl('legacy_static needs an access token (or SHOPIFY_STORE_TOKEN in env)'));
    }
    input = { strategy: 'legacy_static', accessToken };
  } else {
    const clientId = data.clientId || process.env.SHOPIFY_CLIENT_ID || '';
    const clientSecret = data.clientSecret || process.env.SHOPIFY_CLIENT_SECRET || '';
    if (!clientId || !clientSecret) {
      redirect(
        errorUrl('client_credentials needs client id and secret (or SHOPIFY_CLIENT_ID/SECRET in env)'),
      );
    }
    input = { strategy: 'client_credentials', clientId, clientSecret };
  }

  let scopeWarning: string | null = null;
  let failure: string | null = null;
  try {
    ({ scopeWarning } = await connectShopifyStore({
      tenantId: data.tenantId,
      shopDomain: data.shopDomain,
      ...input,
    }));
  } catch (error) {
    failure = error instanceof Error ? (error.message.split('\n')[0] ?? error.message) : 'connect failed';
  }
  if (failure !== null) redirect(errorUrl(failure));

  await writeAuditLog({
    actor: session.sub,
    action: 'connection.create',
    tenantId: data.tenantId,
    subject: data.shopDomain,
    metadata: { strategy: data.strategy, scopeWarning: scopeWarning !== null },
  });
  redirect(`${back}?saved=1${scopeWarning ? `&warning=${encodeURIComponent(scopeWarning)}` : ''}`);
}
