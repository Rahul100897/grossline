export * as schema from './schema';
export { withTenant, type ScopedDb } from './tenant-scope';
export {
  createTenant,
  getTenant,
  getTenantBySlug,
  listTenants,
  listActiveTenants,
  type CreateTenantInput,
  type Tenant,
} from './admin';
export { seedDemoTenant, type SeedSummary } from './seed-demo';
export {
  putCredential,
  getCredential,
  type CredentialProvider,
  type CredentialPayload,
} from './credentials';
export { getCursor, setCursor, clearCursors } from './cursors';
export { createStore, listStores, type Store, type CreateStoreInput } from './stores';
export {
  upsertRawShopifyOrders,
  upsertRawShopifyCustomers,
  upsertRawShopifyProducts,
  countRawShopify,
} from './raw-shopify';
export {
  upsertRawMetaInsights,
  countRawMetaInsights,
  type MetaInsightRow,
} from './raw-meta';
export {
  upsertRawGoogleAdsInsights,
  countRawGoogleAdsInsights,
  type GoogleAdsInsightRow,
} from './raw-google-ads';
export { upsertFxRates, getFxRate, type FxRateInput, type FxRate } from './fx';
export { listCurrenciesInUse } from './currencies';
export {
  createConnection,
  listConnections,
  getConnection,
  updateConnectionHealth,
  updateConnectionSettings,
  markBackfillComplete,
  resetBackfill,
  type Connection,
  type CreateConnectionInput,
} from './connections';
export { getBackfillProgress, type BackfillProgress } from './backfill-progress';
export { closeDbPools } from './client';
export { runMigrations } from './migrate';
export {
  compareMetric,
  rollingMetric,
  type ComparisonKind,
  type MetricComparison,
  type RollingWindow,
} from './comparisons';
export {
  upsertMetricValues,
  getMetricValues,
  listMetricValuesForPeriod,
  startMetricRun,
  finishMetricRun,
  type MetricGrain,
  type MetricValueInput,
  type MetricValueRow,
  type MetricRun,
} from './metric-values';
export {
  upsertTenantCostInputs,
  listTenantCostInputs,
  getCostInputsEffectiveOn,
  type TenantCostInputs,
  type TenantCostInputsInput,
} from './cost-inputs';
export {
  upsertProductCosts,
  listProductCosts,
  listCostableOrderLines,
  importShopifyCosts,
  type ProductCostInput,
} from './product-costs';
export {
  getAdminUserByEmail,
  upsertAdminUser,
  writeAuditLog,
  type AdminUser,
} from './admin-users';
