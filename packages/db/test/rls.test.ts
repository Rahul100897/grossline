import { randomUUID } from 'node:crypto';
import { afterAll, describe, expect, it } from 'vitest';
import { adminPool, appPool, closeDbPools } from '../src/client';

afterAll(async () => {
  await closeDbPools();
});

async function createTenantAsAdmin(slug: string): Promise<string> {
  const res = await adminPool().query<{ id: string }>(
    `INSERT INTO tenants (name, slug, reporting_currency, reporting_timezone)
     VALUES ($1, $2, 'USD', 'UTC') RETURNING id`,
    [slug, slug],
  );
  return res.rows[0]!.id;
}

describe('row-level security', () => {
  it('a query without a tenant context returns zero rows', async () => {
    const tenantId = await createTenantAsAdmin(`rls-a-${randomUUID().slice(0, 8)}`);
    await adminPool().query(
      `INSERT INTO stores (tenant_id, shop_domain, store_currency, store_timezone)
       VALUES ($1, $2, 'USD', 'UTC')`,
      [tenantId, `rls-test-${tenantId.slice(0, 8)}.myshopify.com`],
    );

    // Sanity: the row is really there when RLS does not apply.
    const asAdmin = await adminPool().query('SELECT id FROM stores WHERE tenant_id = $1', [
      tenantId,
    ]);
    expect(asAdmin.rowCount).toBe(1);

    // App connection, no app.tenant_id set: every tenant table reads empty.
    for (const table of ['tenants', 'stores', 'connections', 'credentials', 'sync_runs']) {
      const res = await appPool().query(`SELECT * FROM ${table}`);
      expect(res.rowCount, `${table} must be invisible without tenant context`).toBe(0);
    }
  });

  it('a tenant context sees only its own rows', async () => {
    const tenantId = await createTenantAsAdmin(`rls-b-${randomUUID().slice(0, 8)}`);
    const client = await appPool().connect();
    try {
      await client.query('BEGIN');
      await client.query(`SELECT set_config('app.tenant_id', $1, true)`, [tenantId]);
      const tenantsSeen = await client.query<{ id: string }>('SELECT id FROM tenants');
      await client.query('COMMIT');
      expect(tenantsSeen.rows.map((r) => r.id)).toEqual([tenantId]);
    } finally {
      client.release();
    }
  });

  it('the app role cannot read admin_users at all', async () => {
    await expect(appPool().query('SELECT * FROM admin_users')).rejects.toThrow(
      /permission denied/,
    );
  });
});
