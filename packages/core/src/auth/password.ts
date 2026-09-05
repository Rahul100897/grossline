import { randomBytes, scryptSync, timingSafeEqual } from 'node:crypto';

// scrypt parameters per OWASP recommendation (N=2^14, r=8, p=1 minimum).
const N = 16384;
const R = 8;
const P = 1;
const KEYLEN = 64;

export function hashPassword(password: string): string {
  const salt = randomBytes(16);
  const hash = scryptSync(password, salt, KEYLEN, { N, r: R, p: P });
  return `scrypt$${N}$${R}$${P}$${salt.toString('base64')}$${hash.toString('base64')}`;
}

export function verifyPassword(password: string, stored: string): boolean {
  const parts = stored.split('$');
  if (parts.length !== 6 || parts[0] !== 'scrypt') return false;
  const [, nRaw, rRaw, pRaw, saltRaw, hashRaw] = parts;
  const n = Number(nRaw);
  const r = Number(rRaw);
  const p = Number(pRaw);
  if (!Number.isInteger(n) || !Number.isInteger(r) || !Number.isInteger(p)) return false;
  const salt = Buffer.from(saltRaw!, 'base64');
  const expected = Buffer.from(hashRaw!, 'base64');
  const actual = scryptSync(password, salt, expected.length, { N: n, r, p });
  return expected.length === actual.length && timingSafeEqual(expected, actual);
}
