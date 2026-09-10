'use server';

import { redirect } from 'next/navigation';
import { z } from 'zod';
import { getTenant, offboardTenant, updateTenant, writeAuditLog } from '@grossline/db';
import { requireSession } from '../../../../lib/auth';

const tenantIdSchema = z.string().uuid();

/** Convert a trial to a paying merchant (task 5.B7) — records the decision. */
export async function convertTrial(formData: FormData): Promise<void> {
  const session = await requireSession();
  const tenantId = tenantIdSchema.parse(formData.get('tenantId'));
  await updateTenant(tenantId, { status: 'active' });
  await writeAuditLog({ actor: session.sub, action: 'tenant.convert', tenantId });
  redirect(`/merchants/${tenantId}?saved=converted`);
}

/**
 * Offboard a merchant (task 5.B7): revoke connections and delete all their data
 * on a single action, then mark them churned. Destructive and irreversible, so
 * it requires typing the tenant slug to confirm.
 */
export async function offboard(formData: FormData): Promise<void> {
  const session = await requireSession();
  const tenantId = tenantIdSchema.parse(formData.get('tenantId'));
  const confirm = String(formData.get('confirm') ?? '').trim();
  const tenant = await getTenant(tenantId);
  if (!tenant) redirect('/merchants');
  if (confirm !== tenant!.slug) {
    redirect(
      `/merchants/${tenantId}?error=${encodeURIComponent('Type the merchant slug to confirm offboarding.')}`,
    );
  }
  await offboardTenant(tenantId);
  await writeAuditLog({
    actor: session.sub,
    action: 'tenant.offboard',
    tenantId,
    subject: tenant!.slug,
  });
  redirect(`/merchants/${tenantId}?saved=offboarded`);
}
