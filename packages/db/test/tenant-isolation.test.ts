import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { closeDbPools } from '../src/client';
import { createTenant, listTenants } from '../src/admin';
import { withTenant } from '../src/tenant-scope';
import { stores, tenants } from '../src/schema';

let tenantA: string;
let tenantB: string;
const suffix = randomUUID().slice(0, 8);

beforeAll(async () => {
  tenantA = (
    await createTenant({
      name: 'Tenant A',
      slug: `iso-a-${suffix}`,
      reportingCurrency: 'USD',
      reportingTimezone: 'UTC',
    })
  ).id;
  tenantB = (
    await createTenant({
      name: 'Tenant B',
      slug: `iso-b-${suffix}`,
      reportingCurrency: 'EUR',
      reportingTimezone: 'Europe/Berlin',
    })
  ).id;

  await withTenant(tenantA, async (tx) => {
    await tx.insert(stores).values({
      tenantId: tenantA,
      shopDomain: `iso-a-${suffix}.myshopify.com`,
      storeCurrency: 'USD',
      storeTimezone: 'UTC',
    });
  });
  await withTenant(tenantB, async (tx) => {
    await tx.insert(stores).values({
      tenantId: tenantB,
      shopDomain: `iso-b-${suffix}.myshopify.com`,
      storeCurrency: 'EUR',
      storeTimezone: 'Europe/Berlin',
    });
  });
});

afterAll(async () => {
  await closeDbPools();
});

describe('tenant isolation through exported helpers', () => {
  it("tenant A's context cannot read tenant B's stores", async () => {
    const seen = await withTenant(tenantA, (tx) => tx.select().from(stores));
    expect(seen.length).toBeGreaterThan(0);
    expect(seen.every((s) => s.tenantId === tenantA)).toBe(true);
    expect(seen.some((s) => s.tenantId === tenantB)).toBe(false);
  });

  it("tenant A's context sees only its own tenants row", async () => {
    const seen = await withTenant(tenantA, (tx) => tx.select().from(tenants));
    expect(seen.map((t) => t.id)).toEqual([tenantA]);
  });

  it('tenant A cannot write a row that belongs to tenant B', async () => {
    const smuggleDomain = `iso-smuggle-${suffix}.myshopify.com`;
    const attempt = withTenant(tenantA, (tx) =>
      tx.insert(stores).values({
        tenantId: tenantB,
        shopDomain: smuggleDomain,
        storeCurrency: 'USD',
        storeTimezone: 'UTC',
      }),
    );
    // drizzle wraps the pg error; the RLS violation sits in the cause chain.
    await expect(attempt).rejects.toSatisfy((err: unknown) => {
      const cause = err instanceof Error ? err.cause : undefined;
      return cause instanceof Error && /row-level security/.test(cause.message);
    });
    // And the row must not exist for anyone.
    const seenByB = await withTenant(tenantB, (tx) => tx.select().from(stores));
    expect(seenByB.some((s) => s.shopDomain === smuggleDomain)).toBe(false);
  });

  it('rejects a non-uuid tenant id before touching the database', async () => {
    await expect(withTenant('not-a-uuid', (tx) => tx.select().from(stores))).rejects.toThrow();
  });

  it('listTenants is the explicit admin path and sees every tenant', async () => {
    const all = await listTenants();
    const ids = all.map((t) => t.id);
    expect(ids).toContain(tenantA);
    expect(ids).toContain(tenantB);
  });
});
