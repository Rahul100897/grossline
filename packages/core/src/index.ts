export { loadRootEnv, findUp } from './env';
export { logger } from './logger';
export {
  zoneOffsetMinutes,
  wallTimeToUtc,
  dateInZone,
  monthWindow,
  previousMonthPeriod,
  yearAgoPeriod,
  lastNDates,
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
  EPOCH_EFFECTIVE_FROM,
  type ProductCostRow,
  type ResolvedCost,
  type OrderLineForCosting,
  type CostCoverage,
  type CostProvenance,
} from './costs';
export { parseCsv } from './csv';
export { orderFactsFromPayload, type OrderFacts, type OrderLineFact } from './metrics/order-facts';
export { computeRevenueMetrics, rate, type MetricPoint } from './metrics/revenue';
export { computeCustomerMetrics, acquisitionCohortIds, cohortAnchor } from './metrics/customers';
export {
  computeBlendedMetrics,
  platformForSource,
  PLATFORM_SOURCES,
} from './metrics/blended';
export {
  computeMarginMetrics,
  type CostInputsSnapshot,
  type AdSpendForMonth,
} from './metrics/margin';
export { computeAdPlatformMetrics, type PlatformDay } from './metrics/ad-platforms';
export { computeChannelMetrics } from './metrics/channels';

// ---- findings engine (Phase 4) ----
export { reconcileFindings } from './findings/state-machine';
export {
  calibrateThresholds,
  DEFAULT_MIN_IMPACT_FLOOR_MINOR,
  DEFAULT_DEAD_CAMPAIGN_FLOOR_MINOR,
  DEFAULT_CLAIM_GAP_TOLERANCE,
  DEFAULT_DISCOUNT_LEAKAGE_CEIL,
  DEFAULT_BRANDED_SHARE_CEIL,
  DEFAULT_PACING_OVERAGE_PCT,
  REFUND_RATE_MULTIPLE,
  type FindingThresholds,
  type CalibrationMonth,
  type CalibrationInput,
} from './findings/calibration';
export {
  RULES,
  IMPACT_FLOOR_EXEMPT_RULES,
  belowBreakEvenMer,
  deadCampaign,
  brandedSearchShare,
  searchTermWaste,
  discountLeakage,
  refundOutlier,
  paybackBroken,
  claimGap,
  spendPacing,
} from './findings/rules';
export type {
  Rule,
  FindingsInput,
  AccountMetrics,
  CampaignFact,
  SearchTermFact,
  ProductRefundFact,
  ChannelClaimFact,
  DataAvailability,
} from './findings/rule-types';
export { rankAndSuppress, nothingNeedsChanging, DEFAULT_FINDINGS_CAP } from './findings/ranking';
export type { RankedFinding } from './findings/ranking';
export {
  renderTemplate,
  allowedFigures,
  foreignFigures,
  hasNoForeignFigures,
} from './findings/commentary';
export type { CommentaryFinding, FourPart } from './findings/commentary';
export { classifyRecommendation } from './findings/recommendations';
export type { RecStatus, RecommendationInput, RecommendationJudgement } from './findings/recommendations';
export type {
  FindingEntity,
  FindingFamily,
  FindingSeverity,
  FindingStatus,
  Evidence,
  FindingDraft,
  RuleOutcome,
  PriorFinding,
  ReconciledFinding,
  ResolvedFinding,
  ReconcileInput,
  ReconcileOutput,
} from './findings/types';
export { valueIsExclusive } from './findings/types';
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
