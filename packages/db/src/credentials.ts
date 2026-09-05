// Envelope encryption for platform credentials.
//
// Each credential gets its own random 256-bit data key. The payload is
// encrypted with the data key (AES-256-GCM); the data key is wrapped with the
// master key from the environment (AES-256-GCM again). The wrapped key travels
// inside the ciphertext column, the payload IV in the iv column, and the
// master key version in key_version so keys can rotate without re-encrypting
// history all at once.
//
// Nothing in this module logs, throws, or returns plaintext except
// getCredential's decrypted result. Keep it that way.
import { createCipheriv, createDecipheriv, randomBytes } from 'node:crypto';
import { eq } from 'drizzle-orm';
import { z } from 'zod';
import { loadRootEnv } from '@grossline/core';
import { credentials } from './schema';
import { withTenant } from './tenant-scope';

const providerSchema = z.enum(['shopify', 'google_ads', 'meta']);
const payloadSchema = z.record(z.string(), z.unknown());

export type CredentialProvider = z.infer<typeof providerSchema>;
export type CredentialPayload = z.infer<typeof payloadSchema>;

const envelopeSchema = z.object({
  v: z.literal(1),
  wrap: z.object({ iv: z.string(), ct: z.string(), tag: z.string() }),
  data: z.object({ ct: z.string(), tag: z.string() }),
});

function currentKeyVersion(): number {
  const raw = process.env.MASTER_KEY_VERSION;
  if (!raw) return 1;
  const version = Number.parseInt(raw, 10);
  if (!Number.isInteger(version) || version < 1) {
    throw new Error('MASTER_KEY_VERSION must be a positive integer');
  }
  return version;
}

// Non-production fallback so a fresh clone can run `pnpm verify` before
// writing a .env. Known key — never acceptable outside local dev/tests.
const DEV_MASTER_KEY = Buffer.from('grossline-local-dev-master-key!!', 'utf8').toString('base64');

function masterKeyForVersion(version: number): Buffer {
  loadRootEnv();
  const envName = version === currentKeyVersion() ? 'MASTER_KEY' : `MASTER_KEY_V${version}`;
  let raw = process.env[envName];
  if (!raw && envName === 'MASTER_KEY' && process.env.NODE_ENV !== 'production') {
    raw = DEV_MASTER_KEY;
  }
  if (!raw) throw new Error(`master key for version ${version} not present (${envName})`);
  const key = Buffer.from(raw, 'base64');
  if (key.length !== 32) throw new Error(`${envName} must be a base64-encoded 32-byte key`);
  return key;
}

function encrypt(key: Buffer, plaintext: Buffer): { iv: Buffer; ct: Buffer; tag: Buffer } {
  const iv = randomBytes(12);
  const cipher = createCipheriv('aes-256-gcm', key, iv);
  const ct = Buffer.concat([cipher.update(plaintext), cipher.final()]);
  return { iv, ct, tag: cipher.getAuthTag() };
}

function decrypt(key: Buffer, iv: Buffer, ct: Buffer, tag: Buffer): Buffer {
  const decipher = createDecipheriv('aes-256-gcm', key, iv);
  decipher.setAuthTag(tag);
  return Buffer.concat([decipher.update(ct), decipher.final()]);
}

/**
 * Encrypt and store a credential for a tenant. Returns the credential ref
 * (row id) to hang on a connection.
 */
export async function putCredential(
  tenantId: string,
  provider: CredentialProvider,
  payload: CredentialPayload,
): Promise<string> {
  providerSchema.parse(provider);
  const plaintext = Buffer.from(JSON.stringify(payloadSchema.parse(payload)), 'utf8');
  const keyVersion = currentKeyVersion();
  const masterKey = masterKeyForVersion(keyVersion);

  const dataKey = randomBytes(32);
  const data = encrypt(dataKey, plaintext);
  const wrap = encrypt(masterKey, dataKey);

  const envelope = {
    v: 1 as const,
    wrap: { iv: wrap.iv.toString('base64'), ct: wrap.ct.toString('base64'), tag: wrap.tag.toString('base64') },
    data: { ct: data.ct.toString('base64'), tag: data.tag.toString('base64') },
  };

  const [row] = await withTenant(tenantId, (tx) =>
    tx
      .insert(credentials)
      .values({
        tenantId,
        provider,
        ciphertext: Buffer.from(JSON.stringify(envelope), 'utf8').toString('base64'),
        iv: data.iv.toString('base64'),
        keyVersion,
      })
      .returning({ id: credentials.id }),
  );
  if (!row) throw new Error('credential insert returned no row');
  return row.id;
}

/**
 * Fetch and decrypt one credential. Tenant-scoped like every other read:
 * a ref from another tenant returns null, it does not error distinguishably.
 */
export async function getCredential(
  tenantId: string,
  ref: string,
): Promise<{ provider: CredentialProvider; payload: CredentialPayload; keyVersion: number } | null> {
  const refId = z.string().uuid().parse(ref);
  const [row] = await withTenant(tenantId, (tx) =>
    tx.select().from(credentials).where(eq(credentials.id, refId)).limit(1),
  );
  if (!row) return null;

  const masterKey = masterKeyForVersion(row.keyVersion);
  const envelope = envelopeSchema.parse(
    JSON.parse(Buffer.from(row.ciphertext, 'base64').toString('utf8')),
  );
  const dataKey = decrypt(
    masterKey,
    Buffer.from(envelope.wrap.iv, 'base64'),
    Buffer.from(envelope.wrap.ct, 'base64'),
    Buffer.from(envelope.wrap.tag, 'base64'),
  );
  const plaintext = decrypt(
    dataKey,
    Buffer.from(row.iv, 'base64'),
    Buffer.from(envelope.data.ct, 'base64'),
    Buffer.from(envelope.data.tag, 'base64'),
  );
  return {
    provider: providerSchema.parse(row.provider),
    payload: payloadSchema.parse(JSON.parse(plaintext.toString('utf8'))),
    keyVersion: row.keyVersion,
  };
}
