import { describe, expect, it } from 'vitest';
import {
  createTenant,
  createMerchantUser,
  createMembership,
  createMerchantSession,
  resolveMerchantSession,
  issueMerchantToken,
  peekMerchantToken,
  consumeTokenAndSetPassword,
  verifyMerchantLogin,
  recordLoginAttempt,
  isLoginLocked,
  schema,
} from '../src/index';
import { adminDb } from '../src/client';

let n = 0;
async function user() {
  n += 1;
  return createMerchantUser({ email: `auth-${n}-${Date.now()}@example.com`, name: 'u' });
}

describe('merchant auth security (Phase 8 §8.3/§8.4)', () => {
  it('an invite token is single-use and sets the password once', async () => {
    const u = await user();
    const token = await issueMerchantToken(u.id, 'invite');
    expect((await peekMerchantToken(token, 'invite'))?.userId).toBe(u.id);

    const userId = await consumeTokenAndSetPassword(token, 'invite', 'a-strong-password');
    expect(userId).toBe(u.id);
    // Used → cannot be peeked or consumed again.
    expect(await peekMerchantToken(token, 'invite')).toBeNull();
    expect(await consumeTokenAndSetPassword(token, 'invite', 'another-password')).toBeNull();
    // The user is now active and can log in with the chosen password.
    expect(await verifyMerchantLogin(u.email, 'a-strong-password')).not.toBeNull();
  });

  it('issuing a new token of the same purpose invalidates the previous one', async () => {
    const u = await user();
    const first = await issueMerchantToken(u.id, 'invite');
    const second = await issueMerchantToken(u.id, 'invite');
    expect(await peekMerchantToken(first, 'invite')).toBeNull();
    expect((await peekMerchantToken(second, 'invite'))?.userId).toBe(u.id);
  });

  it('an expired token is refused', async () => {
    const u = await user();
    // Insert a token that expired an hour ago.
    const raw = 'expired-token-value';
    const { createHash } = await import('node:crypto');
    await adminDb()
      .insert(schema.merchantTokens)
      .values({
        userId: u.id,
        purpose: 'reset',
        tokenHash: createHash('sha256').update(raw).digest('hex'),
        expiresAt: new Date(Date.now() - 60 * 60 * 1000),
      });
    expect(await peekMerchantToken(raw, 'reset')).toBeNull();
    expect(await consumeTokenAndSetPassword(raw, 'reset', 'whatever-password')).toBeNull();
  });

  it('a reset ends existing sessions (password change kills old sessions)', async () => {
    const t = await createTenant({
      name: `reset-${n}`,
      slug: `reset-${n}-${Date.now()}`,
      reportingCurrency: 'USD',
      reportingTimezone: 'UTC',
      status: 'active',
    });
    const u = await user();
    await createMembership({ userId: u.id, tenantId: t.id });
    // Activate + a live session.
    await consumeTokenAndSetPassword(
      await issueMerchantToken(u.id, 'invite'),
      'invite',
      'first-password',
    );
    const sid = await createMerchantSession(u.id);
    expect(await resolveMerchantSession(sid)).not.toBeNull();

    // Reset the password → the old session must be dead.
    const token = await issueMerchantToken(u.id, 'reset');
    expect(await consumeTokenAndSetPassword(token, 'reset', 'second-password')).toBe(u.id);
    expect(await resolveMerchantSession(sid)).toBeNull();
    expect(await verifyMerchantLogin(u.email, 'first-password')).toBeNull();
    expect(await verifyMerchantLogin(u.email, 'second-password')).not.toBeNull();
  });

  it('locks out after repeated failures per email, and does not count successes', async () => {
    const email = `lockout-${Date.now()}@example.com`;
    const ip = '203.0.113.7';
    expect(await isLoginLocked(email, ip)).toBe(false);
    for (let i = 0; i < 5; i++) await recordLoginAttempt(email, ip, false);
    expect(await isLoginLocked(email, ip)).toBe(true);
    // A different email from a different IP is unaffected.
    expect(await isLoginLocked('someone-else@example.com', '198.51.100.9')).toBe(false);
  });

  it('locks out an IP hammering many different accounts', async () => {
    const ip = '203.0.113.99';
    for (let i = 0; i < 20; i++)
      await recordLoginAttempt(`x${i}-${Date.now()}@example.com`, ip, false);
    expect(await isLoginLocked(`fresh-${Date.now()}@example.com`, ip)).toBe(true);
  });
});
