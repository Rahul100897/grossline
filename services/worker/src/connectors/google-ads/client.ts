import { z } from 'zod';
import { fetchWithRetry } from '../http';
import type { SyncContext } from '../types';

export const googleAdsCredentialsSchema = z.object({
  /** Client account customer id, digits only. */
  customerId: z.string().regex(/^\d+$/),
  refreshToken: z.string().min(1),
});
export type GoogleAdsCredentials = z.infer<typeof googleAdsCredentialsSchema>;

export function googleAdsApiVersion(): string {
  return process.env.GOOGLE_ADS_API_VERSION || 'v18';
}

function requiredEnv(name: string): string {
  const value = process.env[name];
  if (!value) throw new Error(`${name} is not set`);
  return value;
}

export const digitsOnly = (id: string): string => id.replace(/\D/g, '');

// ---- OAuth: refresh-token → short-lived access token, cached until expiry ----

const tokenResponseSchema = z.object({
  access_token: z.string(),
  expires_in: z.number(),
  token_type: z.string(),
});

type CachedToken = { accessToken: string; expiresAt: number };
const tokenCache = new Map<string, CachedToken>();

export function clearGoogleTokenCache(): void {
  tokenCache.clear();
}

export async function getAccessToken(ctx: SyncContext, refreshToken: string): Promise<string> {
  const cached = tokenCache.get(refreshToken);
  if (cached && cached.expiresAt > Date.now() + 60_000) return cached.accessToken;

  const res = await fetchWithRetry(
    'https://oauth2.googleapis.com/token',
    {
      method: 'POST',
      headers: { 'content-type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        client_id: requiredEnv('GOOGLE_ADS_CLIENT_ID'),
        client_secret: requiredEnv('GOOGLE_ADS_CLIENT_SECRET'),
        refresh_token: refreshToken,
        grant_type: 'refresh_token',
      }).toString(),
    },
    { fetchImpl: ctx.fetchImpl },
  );
  if (!res.ok) {
    throw new Error(`google oauth: HTTP ${res.status} refreshing access token`);
  }
  const token = tokenResponseSchema.parse(await res.json());
  tokenCache.set(refreshToken, {
    accessToken: token.access_token,
    expiresAt: Date.now() + token.expires_in * 1000,
  });
  return token.access_token;
}

// ---- searchStream ----

const errorBodySchema = z.object({
  error: z
    .object({
      code: z.number().optional(),
      status: z.string().optional(),
      message: z.string().optional(),
      details: z.array(z.record(z.string(), z.unknown())).optional(),
    })
    .passthrough(),
});

/** Error the caller should surface as connection health, not a crash. */
export class GoogleAdsUnlinkedAccountError extends Error {
  constructor(customerId: string) {
    super(
      `Google Ads account ${customerId} is not accessible with this login-customer-id — ` +
        'link the client account to the MCC (an onboarding step per account), then re-sync.',
    );
    this.name = 'GoogleAdsUnlinkedAccountError';
  }
}

function isPermissionError(bodyText: string): boolean {
  return /USER_PERMISSION_DENIED|CUSTOMER_NOT_ENABLED|NOT_ADS_USER|PERMISSION_DENIED/.test(bodyText);
}

const searchStreamSchema = z.array(
  z.object({
    results: z.array(z.record(z.string(), z.unknown())).optional(),
    fieldMask: z.string().optional(),
  }),
);

/**
 * Run a GAQL query via REST searchStream. `login-customer-id` (the MCC id,
 * digits only) travels on every call — client accounts must be linked to the
 * MCC or the API answers PERMISSION_DENIED, surfaced as a typed error.
 */
export async function googleAdsSearchStream(
  ctx: SyncContext,
  creds: GoogleAdsCredentials,
  loginCustomerId: string,
  query: string,
): Promise<Record<string, unknown>[]> {
  const accessToken = await getAccessToken(ctx, creds.refreshToken);
  const url = `https://googleads.googleapis.com/${googleAdsApiVersion()}/customers/${digitsOnly(
    creds.customerId,
  )}/googleAds:searchStream`;

  const res = await fetchWithRetry(
    url,
    {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        authorization: `Bearer ${accessToken}`,
        'developer-token': requiredEnv('GOOGLE_ADS_DEVELOPER_TOKEN'),
        'login-customer-id': digitsOnly(loginCustomerId),
      },
      body: JSON.stringify({ query }),
    },
    { fetchImpl: ctx.fetchImpl },
  );

  if (!res.ok) {
    const bodyText = await res.text();
    if (isPermissionError(bodyText)) {
      throw new GoogleAdsUnlinkedAccountError(creds.customerId);
    }
    const parsed = errorBodySchema.safeParse(JSON.parse(bodyText));
    const message = parsed.success ? (parsed.data.error.message ?? bodyText) : bodyText;
    throw new Error(`google ads api: HTTP ${res.status}: ${message}`);
  }

  const chunks = searchStreamSchema.parse(await res.json());
  return chunks.flatMap((chunk) => chunk.results ?? []);
}
