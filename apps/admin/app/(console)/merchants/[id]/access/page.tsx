import { notFound } from 'next/navigation';
import { getTenant, listTenantMerchantUsers } from '@grossline/db';
import { requireSession } from '../../../../../lib/auth';
import { formatDate } from '../../../../../lib/format';
import { Badge, EmptyState, Panel, Table, Td, Th, Tr } from '../../../../../components/ui';
import {
  inviteUser,
  resendInvite,
  changeRole,
  revokeAccess,
  disableUser,
  startViewAs,
} from './actions';

export const dynamic = 'force-dynamic';

export default async function AccessPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ invited?: string; error?: string }>;
}) {
  await requireSession();
  const { id } = await params;
  const { invited, error } = await searchParams;
  const tenant = await getTenant(id);
  if (!tenant) notFound();
  const users = await listTenantMerchantUsers(id);
  const hidden = <input type="hidden" name="tenantId" value={id} />;

  return (
    <>
      <p className="mb-3 text-body text-slate">
        Portal users who can sign in and read <b>{tenant.name}</b>&rsquo;s reports. Access is
        read-only and by invitation only.
      </p>

      {invited ? (
        <div className="gl-empty mb-3" style={{ color: 'var(--gl-green)' }}>
          Invitation sent. The link is valid for 72 hours.
        </div>
      ) : null}
      {error ? (
        <div className="gl-error mb-3">Check the email, name and role, then try again.</div>
      ) : null}

      {users.length === 0 ? (
        <EmptyState>No portal users yet. Invite the first one below.</EmptyState>
      ) : (
        <Panel>
          <Table>
            <thead>
              <tr>
                <Th>name</Th>
                <Th>email</Th>
                <Th>role</Th>
                <Th>status</Th>
                <Th>last login</Th>
                <Th>actions</Th>
              </tr>
            </thead>
            <tbody>
              {users.map((u) => (
                <Tr key={u.userId}>
                  <Td>{u.name}</Td>
                  <Td>{u.email}</Td>
                  <Td>
                    <form action={changeRole} className="flex items-center gap-1">
                      {hidden}
                      <input type="hidden" name="userId" value={u.userId} />
                      <select name="role" defaultValue={u.role} className="gl-sel">
                        <option value="viewer">viewer</option>
                        <option value="owner">owner</option>
                      </select>
                      <button type="submit" className="gl-btn ghost sm">
                        Save
                      </button>
                    </form>
                  </Td>
                  <Td>
                    <Badge tone={u.status === 'active' ? 'good' : u.status === 'disabled' ? 'attn' : 'neutral'}>
                      {u.status}
                    </Badge>
                    {u.isDemo ? <Badge>demo</Badge> : null}
                  </Td>
                  <Td quiet>{u.lastLoginAt ? formatDate(u.lastLoginAt) : 'never'}</Td>
                  <Td>
                    <div className="flex flex-wrap gap-1">
                      {u.status === 'active' ? (
                        <form action={startViewAs}>
                          {hidden}
                          <input type="hidden" name="userId" value={u.userId} />
                          <button type="submit" className="gl-btn ghost sm">
                            View as
                          </button>
                        </form>
                      ) : null}
                      {u.status === 'invited' ? (
                        <form action={resendInvite}>
                          {hidden}
                          <input type="hidden" name="userId" value={u.userId} />
                          <input type="hidden" name="email" value={u.email} />
                          <button type="submit" className="gl-btn ghost sm">
                            Resend invite
                          </button>
                        </form>
                      ) : null}
                      <form action={revokeAccess}>
                        {hidden}
                        <input type="hidden" name="userId" value={u.userId} />
                        <button type="submit" className="gl-btn ghost sm">
                          Revoke
                        </button>
                      </form>
                      {u.status !== 'disabled' && !u.isDemo ? (
                        <form action={disableUser}>
                          {hidden}
                          <input type="hidden" name="userId" value={u.userId} />
                          <button type="submit" className="gl-btn ghost sm">
                            Disable
                          </button>
                        </form>
                      ) : null}
                    </div>
                  </Td>
                </Tr>
              ))}
            </tbody>
          </Table>
        </Panel>
      )}

      <div className="mt-4">
        <h2 className="gl-section mb-2">Invite a user</h2>
        <form action={inviteUser} className="flex flex-wrap items-end gap-2">
          {hidden}
          <label className="flex flex-col gap-1 text-meta">
            Name
            <input name="name" required className="gl-input" />
          </label>
          <label className="flex flex-col gap-1 text-meta">
            Email
            <input name="email" type="email" required className="gl-input" />
          </label>
          <label className="flex flex-col gap-1 text-meta">
            Role
            <select name="role" defaultValue="viewer" className="gl-sel">
              <option value="viewer">viewer</option>
              <option value="owner">owner</option>
            </select>
          </label>
          <button type="submit" className="gl-btn">
            Send invitation
          </button>
        </form>
      </div>
    </>
  );
}
