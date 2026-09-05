// Creates (or updates) the single admin user from environment variables.
//
//   ADMIN_EMAIL          required
//   ADMIN_PASSWORD_HASH  scrypt hash (preferred), or
//   ADMIN_PASSWORD       plaintext to hash now (local convenience)
//   ADMIN_TOTP_SECRET    base32 secret; generated and printed when absent
//
// Prints the otpauth:// URL once so the authenticator app can be enrolled.
// It never prints the password.
import { loadRootEnv, generateTotpSecret, hashPassword, otpauthUrl } from '@grossline/core';
import { closeDbPools } from '../src/client';
import { upsertAdminUser } from '../src/admin-users';

loadRootEnv();

async function main(): Promise<void> {
  const email = process.env.ADMIN_EMAIL;
  if (!email) throw new Error('ADMIN_EMAIL is not set');

  let passwordHash = process.env.ADMIN_PASSWORD_HASH;
  if (!passwordHash) {
    const password = process.env.ADMIN_PASSWORD;
    if (!password) throw new Error('Set ADMIN_PASSWORD_HASH or ADMIN_PASSWORD');
    if (password.length < 12) throw new Error('ADMIN_PASSWORD must be at least 12 characters');
    passwordHash = hashPassword(password);
  }

  const existingSecret = process.env.ADMIN_TOTP_SECRET;
  const totpSecret = existingSecret ?? generateTotpSecret();

  const admin = await upsertAdminUser({ email, passwordHash, totpSecret });
  console.log(`seed-admin: admin user ready (${admin.email})`);
  if (!existingSecret) {
    console.log('seed-admin: new TOTP secret generated. Enroll it now:');
    console.log(`  secret:  ${totpSecret}`);
    console.log(`  otpauth: ${otpauthUrl(totpSecret, admin.email)}`);
    console.log('Add ADMIN_TOTP_SECRET to .env to keep it stable across re-seeds.');
  }
}

main()
  .then(() => closeDbPools())
  .catch(async (err) => {
    console.error('seed-admin failed:', err instanceof Error ? err.message : err);
    await closeDbPools();
    process.exit(1);
  });
