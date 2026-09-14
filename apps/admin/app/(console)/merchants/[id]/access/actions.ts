'use server';

import { redirect } from 'next/navigation';
import { z } from 'zod';
import {
  getMerchantUserByEmail,
  createMerchantUser,
  createMembership,
  issueMerchantToken,
  setMembershipRole,
  removeMembership,
  disableMerchantUser,
  writeAuditLog,
} from '@grossline/db';
import { sendEmail } from '@grossline/worker/email';
import { requireSession } from '../../../../../lib/auth';

const portalBaseUrl = (): string => process.env.PORTAL_BASE_URL ?? 'http://localhost:3002';
const back = (id: string, extra = ''): string => `/merchants/${id}/access${extra}`;

const idSchema = z.string().uuid();
const roleSchema = z.enum(['owner', 'viewer']);

async function tenantId(formData: FormData): Promise<string> {
  return idSchema.parse(formData.get('tenantId'));
}

/** Invite a user to this tenant: find-or-create (invited), grant membership,
 *  issue a single-use invite link and email it. Admin-initiated, so it is fine
 *  to confirm the address back to the console. */
export async function inviteUser(formData: FormData): Promise<void> {
  const session = await requireSession();
  const tid = await tenantId(formData);
  const parsed = z
    .object({
      email: z.string().email(),
      name: z.string().min(1).max(120),
      role: roleSchema,
    })
    .safeParse({
      email: formData.get('email'),
      name: formData.get('name'),
      role: formData.get('role'),
    });
  if (!parsed.success) redirect(back(tid, '?error=1'));
  const { email, name, role } = parsed.data;

  const user = (await getMerchantUserByEmail(email)) ?? (await createMerchantUser({ email, name }));
  await createMembership({ userId: user.id, tenantId: tid, role, invitedBy: session.sub });
  const token = await issueMerchantToken(user.id, 'invite');
  const link = `${portalBaseUrl()}/accept/${token}`;
  await sendEmail({
    to: email,
    subject: 'You have been invited to Grossline',
    text: `You have been invited to view your Grossline reports.\n\nSet your password and sign in (valid for 72 hours):\n\n${link}\n`,
  });
  // Dev affordance: the link is also logged so it can be used without a mailbox.
  console.info(`[invite] ${email} → ${link}`);
  await writeAuditLog({
    actor: session.sub,
    action: 'merchant.invited',
    tenantId: tid,
    subject: user.id,
    metadata: { email, role },
  });
  redirect(back(tid, '?invited=1'));
}

export async function resendInvite(formData: FormData): Promise<void> {
  const session = await requireSession();
  const tid = await tenantId(formData);
  const userId = idSchema.parse(formData.get('userId'));
  const email = z.string().email().parse(formData.get('email'));
  const token = await issueMerchantToken(userId, 'invite');
  const link = `${portalBaseUrl()}/accept/${token}`;
  await sendEmail({
    to: email,
    subject: 'Your Grossline invitation',
    text: `Set your password and sign in (valid for 72 hours):\n\n${link}\n`,
  });
  console.info(`[invite resend] ${email} → ${link}`);
  await writeAuditLog({
    actor: session.sub,
    action: 'merchant.invite_resent',
    tenantId: tid,
    subject: userId,
  });
  redirect(back(tid, '?invited=1'));
}

export async function changeRole(formData: FormData): Promise<void> {
  const session = await requireSession();
  const tid = await tenantId(formData);
  const userId = idSchema.parse(formData.get('userId'));
  const role = roleSchema.parse(formData.get('role'));
  await setMembershipRole(userId, tid, role);
  await writeAuditLog({
    actor: session.sub,
    action: 'merchant.role_changed',
    tenantId: tid,
    subject: userId,
    metadata: { role },
  });
  redirect(back(tid));
}

/** Revoke this user's access to this tenant (membership removed, sessions killed). */
export async function revokeAccess(formData: FormData): Promise<void> {
  const session = await requireSession();
  const tid = await tenantId(formData);
  const userId = idSchema.parse(formData.get('userId'));
  await removeMembership(userId, tid);
  await writeAuditLog({
    actor: session.sub,
    action: 'merchant.access_revoked',
    tenantId: tid,
    subject: userId,
  });
  redirect(back(tid));
}

/** Disable a user entirely (all tenants), killing every live session at once. */
export async function disableUser(formData: FormData): Promise<void> {
  const session = await requireSession();
  const tid = await tenantId(formData);
  const userId = idSchema.parse(formData.get('userId'));
  await disableMerchantUser(userId);
  await writeAuditLog({ actor: session.sub, action: 'merchant.user_disabled', subject: userId });
  redirect(back(tid));
}
