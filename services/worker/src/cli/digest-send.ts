// Weekly digest (task 5.B5):
//   pnpm digest:send <tenantId> <YYYY-MM-DD> [recipientEmail]
// Builds the trailing-7-day digest ending on the given date and prints it. When
// a recipient email is given, it is also sent (best-effort via Resend).
import { z } from 'zod';
import { closeDbPools } from '@grossline/db';
import { buildWeeklyDigest } from '../reports/digest';
import { sendEmail } from '../email';

const args = z
  .tuple([z.string().uuid(), z.string().regex(/^\d{4}-\d{2}-\d{2}$/)])
  .rest(z.string())
  .safeParse(process.argv.slice(2));
if (!args.success) {
  console.error('Usage: pnpm digest:send <tenantId> <YYYY-MM-DD> [recipientEmail]');
  process.exit(1);
}
const [tenantId, asOf, recipient] = args.data;

buildWeeklyDigest(tenantId, asOf)
  .then(async (digest) => {
    console.log(`\n${'─'.repeat(48)}\n${digest.text}\n${'─'.repeat(48)}`);
    if (recipient) {
      const result = await sendEmail({
        to: recipient,
        subject: `${digest.input.tenantName} — weekly digest`,
        text: digest.text,
      });
      console.log(result.sent ? `\nSent to ${recipient}.` : `\nNot sent: ${result.reason}`);
    } else {
      console.log('\n(dry run — pass a recipient email to send)');
    }
    await closeDbPools();
  })
  .catch(async (err) => {
    console.error('digest:send failed:', err instanceof Error ? err.message : err);
    await closeDbPools();
    process.exit(1);
  });
