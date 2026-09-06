// The derived-issues engine (docs/phase-3.md tasks 3.2 + 3.4). Issues are
// COMPUTED from current state, never stored — a connection that recovers stops
// being an issue with nobody marking it resolved. New sources (invoices in
// 3.6, tickets in 3.7) add cases here as their tables land.
import { PROVIDER_STREAMS, type Provider } from '@grossline/core';
import {
  getBackfillProgress,
  latestCostCompleteness,
  latestSyncRun,
  listConnections,
  listTenants,
  type Connection,
  type Tenant,
} from '@grossline/db';
import { formatMinor } from './format';

export type IssueSeverity = 'blocking' | 'attention';
export type IssueType =
  | 'connection'
  | 'sync'
  | 'cost-data'
  | 'backfill'
  | 'reconciliation'
  | 'onboarding'
  | 'billing';

export type Issue = {
  id: string;
  severity: IssueSeverity;
  type: IssueType;
  tenantId: string;
  tenant: string;
  summary: string;
  action: string;
  since: Date;
  /** Higher = costs you more today; blocking issues sort first, then this. */
  weight: number;
};

const STUCK_ONBOARDING_DAYS = 3;

function connectionIssues(tenant: Tenant, connection: Connection): Issue[] {
  const issues: Issue[] = [];
  const settings = (connection.settings ?? {}) as Record<string, unknown>;
  const isDemo = settings.demo === true;
  const since = connection.lastSuccessAt ?? tenant.createdAt;

  if (isDemo) return issues; // seeded connections never sync — not a real issue

  if (connection.health === 'broken') {
    issues.push({
      id: `conn-broken-${connection.id}`,
      severity: 'blocking',
      type: 'connection',
      tenantId: tenant.id,
      tenant: tenant.name,
      summary: `${connection.provider} connection broken${connection.lastError ? ` — ${connection.lastError.split('.')[0]}` : ''}`,
      action: connection.lastError ?? 'reconnect the account',
      since,
      weight: 100,
    });
  } else if (connection.health === 'degraded') {
    const scopeWarning = typeof settings.scopeWarning === 'string' ? settings.scopeWarning : null;
    issues.push({
      id: `conn-degraded-${connection.id}`,
      // A scope warning caps history — blocking a correct report going out.
      severity: scopeWarning ? 'blocking' : 'attention',
      type: 'connection',
      tenantId: tenant.id,
      tenant: tenant.name,
      summary: scopeWarning
        ? `${connection.provider}: order history capped at 60 days — read_all_orders not granted`
        : `${connection.provider} connection degraded${connection.lastError ? ` — ${connection.lastError.split('.')[0]}` : ''}`,
      action: scopeWarning ?? connection.lastError ?? 'check the connection',
      since,
      weight: scopeWarning ? 90 : 50,
    });
  } else if (connection.health === 'unknown') {
    issues.push({
      id: `conn-unknown-${connection.id}`,
      severity: 'attention',
      type: 'connection',
      tenantId: tenant.id,
      tenant: tenant.name,
      summary: `${connection.provider} connection has never synced`,
      action: `run a backfill: pnpm worker:sync ${tenant.id} backfill`,
      since,
      weight: 40,
    });
  }
  return issues;
}

export async function deriveIssues(now: Date = new Date()): Promise<Issue[]> {
  const tenants = await listTenants();
  const issues: Issue[] = [];

  for (const tenant of tenants) {
    // Stuck onboarding.
    if (tenant.status === 'onboarding') {
      const ageDays = (now.getTime() - tenant.createdAt.getTime()) / 86_400_000;
      if (ageDays > STUCK_ONBOARDING_DAYS) {
        issues.push({
          id: `onboarding-${tenant.id}`,
          severity: 'attention',
          type: 'onboarding',
          tenantId: tenant.id,
          tenant: tenant.name,
          summary: `onboarding stalled for ${Math.floor(ageDays)} days`,
          action: 'connect a store and run the first backfill',
          since: tenant.createdAt,
          weight: 30,
        });
      }
    }

    const connections = await listConnections(tenant.id);
    for (const connection of connections) {
      issues.push(...connectionIssues(tenant, connection));

      const settings = (connection.settings ?? {}) as Record<string, unknown>;
      if (settings.demo === true) continue;

      // Sync failure (latest run failed).
      const lastSync = await latestSyncRun(tenant.id, connection.id);
      if (lastSync?.status === 'failed') {
        issues.push({
          id: `sync-failed-${connection.id}`,
          severity: 'attention',
          type: 'sync',
          tenantId: tenant.id,
          tenant: tenant.name,
          summary: `last ${connection.provider} sync failed${lastSync.error ? ` — ${lastSync.error.split('.')[0]}` : ''}`,
          action: 'retry the sync; check the connection',
          since: lastSync.finishedAt ?? now,
          weight: 60,
        });
      }

      // Incomplete backfill.
      if (connection.health !== 'broken' && !connection.backfillCompletedAt) {
        const streams = PROVIDER_STREAMS[connection.provider as Provider] ?? [];
        const progress = await getBackfillProgress(tenant.id, connection.id, streams);
        if (progress.windowStart) {
          issues.push({
            id: `backfill-${connection.id}`,
            severity: 'attention',
            type: 'backfill',
            tenantId: tenant.id,
            tenant: tenant.name,
            summary: `${connection.provider} backfill incomplete (${Math.round(progress.overall * 100)}%)`,
            action: 'resume the backfill',
            since: connection.lastSuccessAt ?? tenant.createdAt,
            weight: 35,
          });
        }
      }
    }

    // Missing cost data (from the latest computed month).
    const coverage = await latestCostCompleteness(tenant.id);
    if (coverage && coverage.completeness < 1) {
      const missingPct = Math.round((1 - coverage.completeness) * 100);
      issues.push({
        id: `cost-${tenant.id}`,
        severity: 'attention',
        type: 'cost-data',
        tenantId: tenant.id,
        tenant: tenant.name,
        summary: `${missingPct}% of ${coverage.period} order lines have no unit cost — margin is incomplete`,
        action: 'upload a costs CSV or import from Shopify',
        since: tenant.createdAt,
        weight: 45,
      });
    }
  }

  return issues.sort((a, b) => {
    if (a.severity !== b.severity) return a.severity === 'blocking' ? -1 : 1;
    return b.weight - a.weight;
  });
}

export function issueCounts(issues: Issue[]): { total: number; blocking: number } {
  return {
    total: issues.length,
    blocking: issues.filter((i) => i.severity === 'blocking').length,
  };
}

// re-export so pages don't reach past this module for money formatting of
// issue-derived figures.
export { formatMinor };
