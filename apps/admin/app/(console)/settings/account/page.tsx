// Admin account (task 3.8). Read-only: the account email and 2FA status.
// Changing the password or TOTP secret touches credential storage, which is an
// ask-first, CLI-only operation per CLAUDE.md — so this page surfaces the state
// and the command rather than editing secrets from the browser.
import Link from 'next/link';
import { getAdminUserById, type AdminUser } from '@grossline/db';
import { requireSession } from '../../../../lib/auth';
import {
  Absent,
  EmptyState,
  PageHeader,
  Panel,
  Table,
  Td,
  Tr,
} from '../../../../components/ui';
import { formatDate } from '../../../../lib/format';

export const dynamic = 'force-dynamic';

export default async function AccountPage() {
  const session = await requireSession();
  let user: AdminUser | null = null;
  try {
    user = await getAdminUserById(session.sub);
  } catch {
    // fall through to the empty state
  }

  return (
    <>
      <PageHeader
        title="Admin account"
        sub={
          <Link href="/settings" className="text-slate hover:text-ink">
            ← settings
          </Link>
        }
      />
      {!user ? (
        <EmptyState>Could not load your account.</EmptyState>
      ) : (
        <Panel>
          <Table>
            <tbody>
              <Tr>
                <Td quiet>email</Td>
                <Td>{user.email}</Td>
              </Tr>
              <Tr>
                <Td quiet>two-factor</Td>
                <Td>{user.totpSecret ? 'enabled (authenticator)' : <Absent reason="not set" />}</Td>
              </Tr>
              <Tr>
                <Td quiet>created</Td>
                <Td>{formatDate(user.createdAt)}</Td>
              </Tr>
            </tbody>
          </Table>
        </Panel>
      )}
      <p className="mt-3 max-w-xl text-[12px] text-slate">
        Changing your password or authenticator secret touches credential storage — a deliberate,
        CLI-only operation. Rotate them with <code>pnpm --filter @grossline/worker</code> admin
        tooling rather than from the browser.
      </p>
    </>
  );
}
