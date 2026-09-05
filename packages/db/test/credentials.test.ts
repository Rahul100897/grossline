import { randomUUID } from 'node:crypto';
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { adminPool, closeDbPools } from '../src/client';
import { createTenant } from '../src/admin';
import { getCredential, putCredential } from '../src/credentials';

// Distinctive strings that must never appear in ciphertext or logs.
const SECRET_TOKEN = 'shpat_supersecret_example_token_9f8e7d6c';
const SECRET_REFRESH = 'refresh-1/abcdEFGHijkl-secret';

const payload = {
  accessToken: SECRET_TOKEN,
  refreshToken: SECRET_REFRESH,
  scopes: ['read_orders'],
};

let tenantA: string;
let tenantB: string;

beforeAll(async () => {
  const suffix = randomUUID().slice(0, 8);
  tenantA = (
    await createTenant({
      name: 'Cred A',
      slug: `cred-a-${suffix}`,
      reportingCurrency: 'USD',
      reportingTimezone: 'UTC',
    })
  ).id;
  tenantB = (
    await createTenant({
      name: 'Cred B',
      slug: `cred-b-${suffix}`,
      reportingCurrency: 'USD',
      reportingTimezone: 'UTC',
    })
  ).id;
});

afterEach(() => {
  vi.restoreAllMocks();
});

afterAll(async () => {
  await closeDbPools();
});

describe('credential store', () => {
  it('round-trips a payload through envelope encryption', async () => {
    const ref = await putCredential(tenantA, 'shopify', payload);
    const result = await getCredential(tenantA, ref);
    expect(result).not.toBeNull();
    expect(result!.provider).toBe('shopify');
    expect(result!.payload).toEqual(payload);
    expect(result!.keyVersion).toBeGreaterThanOrEqual(1);
  });

  it('stores no readable substring of the payload at rest', async () => {
    const ref = await putCredential(tenantA, 'shopify', payload);
    const { rows } = await adminPool().query<{
      ciphertext: string;
      iv: string;
    }>('SELECT ciphertext, iv FROM credentials WHERE id = $1', [ref]);
    const row = rows[0]!;
    // The raw column values, plus their base64-decoded forms.
    const atRest = [
      row.ciphertext,
      row.iv,
      Buffer.from(row.ciphertext, 'base64').toString('utf8'),
      Buffer.from(row.ciphertext, 'base64').toString('latin1'),
    ].join('\n');
    for (const secret of [SECRET_TOKEN, SECRET_REFRESH, 'accessToken', 'read_orders']) {
      expect(atRest).not.toContain(secret);
    }
  });

  it('never passes plaintext to any log call', async () => {
    const spies = [
      vi.spyOn(console, 'log'),
      vi.spyOn(console, 'info'),
      vi.spyOn(console, 'warn'),
      vi.spyOn(console, 'error'),
      vi.spyOn(console, 'debug'),
    ];
    const ref = await putCredential(tenantA, 'meta', payload);
    const result = await getCredential(tenantA, ref);
    expect(result!.payload).toEqual(payload);
    for (const spy of spies) {
      for (const call of spy.mock.calls) {
        const logged = call.map((arg) => JSON.stringify(arg) ?? String(arg)).join(' ');
        expect(logged).not.toContain(SECRET_TOKEN);
        expect(logged).not.toContain(SECRET_REFRESH);
      }
    }
  });

  it("a ref from another tenant resolves to null, not someone else's secret", async () => {
    const ref = await putCredential(tenantA, 'google_ads', payload);
    expect(await getCredential(tenantB, ref)).toBeNull();
  });

  it('refuses a malformed master key version', async () => {
    vi.stubEnv('MASTER_KEY_VERSION', 'zero');
    await expect(putCredential(tenantA, 'shopify', payload)).rejects.toThrow(
      /MASTER_KEY_VERSION/,
    );
    vi.unstubAllEnvs();
  });
});
