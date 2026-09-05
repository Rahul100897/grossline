export { loadRootEnv, findUp } from './env';
export { logger } from './logger';

export type Provider = 'shopify' | 'google_ads' | 'meta';
export type TenantStatus = 'onboarding' | 'active' | 'paused' | 'churned';
export type ConnectionHealth = 'healthy' | 'degraded' | 'broken';
export type SyncKind = 'backfill' | 'incremental';
export type SyncStatus = 'running' | 'success' | 'failed';
