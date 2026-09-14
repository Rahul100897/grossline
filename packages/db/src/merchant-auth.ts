// Invite / reset tokens and login rate limiting (Phase 8 §8.3/§8.4). Tokens are
// random, single-use, short-lived; only their hash is stored. Rate limiting
// counts recent failures per email and per IP and locks out after a threshold.
import { createHash, randomBytes } from 'node:crypto';
import { and, eq, gte, isNull, sql } from 'drizzle-orm';
import { adminDb } from './client';
import { merchantLoginAttempts, merchantTokens } from './schema';
import { setMerchantPassword, revokeAllSessionsForUser } from './merchant';

const INVITE_TTL_MS = 72 * 60 * 60 * 1000; // 72 hours (§8.3)
const RESET_TTL_MS = 60 * 60 * 1000; // 1 hour — short (§8.4)

function hashToken(raw: string): string {
  return createHash('sha256').update(raw).digest('hex');
}

/** Issue a single-use token; the raw value is returned once for the link and
 *  never stored. Any existing unused token of the same purpose is invalidated. */
export async function issueMerchantToken(
  userId: string,
  purpose: 'invite' | 'reset',
): Promise<string> {
  await invalidateTokens(userId, purpose);
  const raw = randomBytes(32).toString('base64url');
  const ttl = purpose === 'invite' ? INVITE_TTL_MS : RESET_TTL_MS;
  await adminDb()
    .insert(merchantTokens)
    .values({
      userId,
      purpose,
      tokenHash: hashToken(raw),
      expiresAt: new Date(Date.now() + ttl),
    });
  return raw;
}

async function invalidateTokens(userId: string, purpose: 'invite' | 'reset'): Promise<void> {
  await adminDb()
    .update(merchantTokens)
    .set({ usedAt: new Date() })
    .where(
      and(
        eq(merchantTokens.userId, userId),
        eq(merchantTokens.purpose, purpose),
        isNull(merchantTokens.usedAt),
      ),
    );
}

/** Look up a live token without consuming it (to render the set-password form). */
export async function peekMerchantToken(
  raw: string,
  purpose: 'invite' | 'reset',
): Promise<{ userId: string } | null> {
  const [row] = await adminDb()
    .select()
    .from(merchantTokens)
    .where(
      and(
        eq(merchantTokens.tokenHash, hashToken(raw)),
        eq(merchantTokens.purpose, purpose),
        isNull(merchantTokens.usedAt),
        gte(merchantTokens.expiresAt, new Date()),
      ),
    );
  return row ? { userId: row.userId } : null;
}

/**
 * Consume a token and set the user's password in one atomic step: the token is
 * marked used, the password is set (which activates the user), every other token
 * for the user is invalidated, and all existing sessions are revoked so a
 * password change ends old sessions (§8.4). Returns the user id or null.
 */
export async function consumeTokenAndSetPassword(
  raw: string,
  purpose: 'invite' | 'reset',
  password: string,
): Promise<string | null> {
  const hash = hashToken(raw);
  // Atomically claim the token: only one caller can flip used_at from null.
  const [claimed] = await adminDb()
    .update(merchantTokens)
    .set({ usedAt: new Date() })
    .where(
      and(
        eq(merchantTokens.tokenHash, hash),
        eq(merchantTokens.purpose, purpose),
        isNull(merchantTokens.usedAt),
        gte(merchantTokens.expiresAt, new Date()),
      ),
    )
    .returning({ userId: merchantTokens.userId });
  if (!claimed) return null;

  await setMerchantPassword(claimed.userId, password);
  // Invalidate any other outstanding tokens and end existing sessions.
  await adminDb()
    .update(merchantTokens)
    .set({ usedAt: new Date() })
    .where(and(eq(merchantTokens.userId, claimed.userId), isNull(merchantTokens.usedAt)));
  await revokeAllSessionsForUser(claimed.userId);
  return claimed.userId;
}

// ---- rate limiting / lockout ----

const WINDOW_MS = 15 * 60 * 1000;
const MAX_FAILURES_PER_EMAIL = 5;
const MAX_FAILURES_PER_IP = 20;

export async function recordLoginAttempt(
  email: string,
  ip: string,
  succeeded: boolean,
): Promise<void> {
  await adminDb()
    .insert(merchantLoginAttempts)
    .values({ email: email.toLowerCase(), ip, succeeded });
}

/** True when this email or IP has too many recent failures and should be locked
 *  out for now. Successful logins do not count toward the limit. */
export async function isLoginLocked(email: string, ip: string): Promise<boolean> {
  const since = new Date(Date.now() - WINDOW_MS);
  const [byEmail] = await adminDb()
    .select({ n: sql<number>`count(*)::int` })
    .from(merchantLoginAttempts)
    .where(
      and(
        eq(merchantLoginAttempts.email, email.toLowerCase()),
        eq(merchantLoginAttempts.succeeded, false),
        gte(merchantLoginAttempts.at, since),
      ),
    );
  if ((byEmail?.n ?? 0) >= MAX_FAILURES_PER_EMAIL) return true;
  const [byIp] = await adminDb()
    .select({ n: sql<number>`count(*)::int` })
    .from(merchantLoginAttempts)
    .where(
      and(
        eq(merchantLoginAttempts.ip, ip),
        eq(merchantLoginAttempts.succeeded, false),
        gte(merchantLoginAttempts.at, since),
      ),
    );
  return (byIp?.n ?? 0) >= MAX_FAILURES_PER_IP;
}
