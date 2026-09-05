import { describe, expect, it } from 'vitest';
import { hashPassword, verifyPassword } from '../src/auth/password';
import {
  base32Decode,
  base32Encode,
  generateTotpSecret,
  otpauthUrl,
  totpCode,
  verifyTotp,
} from '../src/auth/totp';
import { createSessionToken, verifySessionToken } from '../src/auth/session';

describe('password hashing', () => {
  it('round-trips and rejects a wrong password', () => {
    const stored = hashPassword('correct horse battery staple');
    expect(stored.startsWith('scrypt$')).toBe(true);
    expect(verifyPassword('correct horse battery staple', stored)).toBe(true);
    expect(verifyPassword('wrong password', stored)).toBe(false);
  });

  it('rejects malformed stored hashes without throwing', () => {
    expect(verifyPassword('x', 'not-a-hash')).toBe(false);
    expect(verifyPassword('x', 'scrypt$a$b$c$d$e')).toBe(false);
  });
});

describe('base32', () => {
  it('round-trips arbitrary bytes', () => {
    const buf = Buffer.from('grossline totp secret!', 'utf8');
    expect(base32Decode(base32Encode(buf)).equals(buf)).toBe(true);
  });
});

describe('totp', () => {
  // RFC 6238 appendix B vector: secret "12345678901234567890", T=59s → 8-digit
  // code 94287082; the 6-digit code is its last six digits (same truncation).
  it('matches the RFC 6238 SHA-1 test vector at T=59', () => {
    const secret = base32Encode(Buffer.from('12345678901234567890', 'ascii'));
    expect(totpCode(secret, 59_000)).toBe('287082');
  });

  it('verifies the current code and rejects a wrong one', () => {
    const secret = generateTotpSecret();
    expect(verifyTotp(secret, totpCode(secret))).toBe(true);
    expect(verifyTotp(secret, '000000')).toBe(false);
    expect(verifyTotp(secret, 'abcdef')).toBe(false);
  });

  it('accepts one step of clock drift and not more', () => {
    const secret = generateTotpSecret();
    const now = Date.now();
    expect(verifyTotp(secret, totpCode(secret, now - 30_000))).toBe(true);
    expect(verifyTotp(secret, totpCode(secret, now - 90_000))).toBe(false);
  });

  it('builds a scannable otpauth url', () => {
    const url = otpauthUrl('ABC234', 'analyst@example.com');
    expect(url).toContain('otpauth://totp/Grossline:analyst%40example.com');
    expect(url).toContain('secret=ABC234');
  });
});

describe('session tokens', () => {
  const secret = 'test-session-secret';

  it('round-trips a valid token', async () => {
    const token = await createSessionToken({ sub: 'admin-1', exp: Date.now() + 60_000 }, secret);
    const payload = await verifySessionToken(token, secret);
    expect(payload?.sub).toBe('admin-1');
  });

  it('rejects expiry, tampering and the wrong secret', async () => {
    const expired = await createSessionToken({ sub: 'a', exp: Date.now() - 1 }, secret);
    expect(await verifySessionToken(expired, secret)).toBeNull();

    const token = await createSessionToken({ sub: 'a', exp: Date.now() + 60_000 }, secret);
    expect(await verifySessionToken(`${token}x`, secret)).toBeNull();
    expect(await verifySessionToken(token, 'other-secret')).toBeNull();
    expect(await verifySessionToken('garbage', secret)).toBeNull();
  });
});
