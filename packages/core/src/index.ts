export { loadRootEnv, findUp } from './env';
export { logger } from './logger';
export {
  zoneOffsetMinutes,
  wallTimeToUtc,
  dateInZone,
  monthWindow,
  type MonthWindow,
} from './time';
export {
  convertMinorUnits,
  minorUnitExponent,
  decimalToMinorUnits,
  type ConvertedAmount,
} from './money';
export {
  resolveUnitCost,
  computeCostCoverage,
  latestEffective,
  type ProductCostRow,
  type ResolvedCost,
  type OrderLineForCosting,
  type CostCoverage,
} from './costs';
export { parseCsv } from './csv';
export { hashPassword, verifyPassword } from './auth/password';
export {
  base32Encode,
  base32Decode,
  generateTotpSecret,
  totpCode,
  verifyTotp,
  otpauthUrl,
} from './auth/totp';
export {
  createSessionToken,
  verifySessionToken,
  type SessionPayload,
} from './auth/session';
export {
  buildShopifyInstallUrl,
  verifyShopifyHmac,
  isValidShopDomain,
  SHOPIFY_OAUTH_SCOPES,
  READ_ALL_ORDERS_WARNING,
  NO_SCOPES_WARNING,
  shopifyScopeWarning,
} from './auth/shopify-oauth';

export type Provider = 'shopify' | 'google_ads' | 'meta';

/**
 * The data streams each provider syncs. Shared so the admin console can
 * compute backfill progress without importing worker code; the worker's
 * connectors assert against this map in tests.
 */
export const PROVIDER_STREAMS: Record<Provider, string[]> = {
  shopify: ['orders', 'customers', 'products'],
  meta: ['account', 'campaign'],
  google_ads: ['campaign'],
};
export type TenantStatus = 'onboarding' | 'active' | 'paused' | 'churned';
export type ConnectionHealth = 'healthy' | 'degraded' | 'broken';
export type SyncKind = 'backfill' | 'incremental';
export type SyncStatus = 'running' | 'success' | 'failed';
