'use server';

import { redirect } from 'next/navigation';
import { z } from 'zod';
import { getMerchantUserByEmail, issueMerchantToken, writeAuditLog } from '@grossline/db';
import { sendPortalEmail, portalBaseUrl } from '../../lib/email';

const requestSchema = z.object({ email: z.string().email() });

export async function requestReset(formData: FormData): Promise<void> {
  const parsed = requestSchema.safeParse({ email: formData.get('email') });
  // Even a malformed email lands on the same confirmation — reveal nothing.
  if (parsed.success) {
    const user = await getMerchantUserByEmail(parsed.data.email);
    if (user && user.status === 'active') {
      const token = await issueMerchantToken(user.id, 'reset');
      await sendPortalEmail({
        to: user.email,
        subject: 'Reset your Grossline password',
        text: `Reset your password with this link (valid for one hour):\n\n${portalBaseUrl()}/reset/${token}\n\nIf you did not ask for this, ignore this email.`,
      });
      await writeAuditLog({
        actor: user.email,
        action: 'merchant.reset_requested',
        subject: user.id,
      });
    }
  }
  // Always the same outcome, whether or not the account exists (§8.4).
  redirect('/reset?sent=1');
}
