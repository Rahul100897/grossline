import Link from 'next/link';
import { listTenants, type Tenant } from '@grossline/db';
import { requireSession } from '../../../lib/auth';
import { formatDate } from '../../../lib/format';
import {
  Badge,
  EmptyState,
  ErrorState,
  PageHeader,
  Panel,
  Table,
  Td,
  Th,
  Tr,
} from '../../../components/ui';

export const dynamic = 'force-dynamic';

export default async function TenantsPage() {
  await requireSession();

  let tenants: Tenant[] | null = null;
  let loadError = false;
  try {
    tenants = await listTenants();
  } catch {
    loadError = true;
  }

  return (
    <>
      <PageHeader title="Tenants" sub="Every merchant, live and demo." />
      {loadError ? (
        <ErrorState>Could not load tenants. Is the database up? Check DATABASE_URL.</ErrorState>
      ) : tenants && tenants.length === 0 ? (
        <EmptyState>No tenants yet. The first one you create will appear here.</EmptyState>
      ) : (
        <Panel>
          <Table>
            <thead>
              <tr>
                <Th>name</Th>
                <Th>slug</Th>
                <Th>status</Th>
                <Th>currency</Th>
                <Th>timezone</Th>
                <Th>created</Th>
              </tr>
            </thead>
            <tbody>
              {tenants!.map((t) => (
                <Tr key={t.id}>
                  <Td>
                    <Link href={`/tenants/${t.id}/costs`} className="hover:underline">
                      {t.name}
                    </Link>{' '}
                    {t.isDemo ? <Badge>demo</Badge> : null}
                  </Td>
                  <Td quiet>{t.slug}</Td>
                  <Td>{t.status}</Td>
                  <Td>{t.reportingCurrency}</Td>
                  <Td quiet>{t.reportingTimezone}</Td>
                  <Td quiet>{formatDate(t.createdAt)}</Td>
                </Tr>
              ))}
            </tbody>
          </Table>
        </Panel>
      )}
    </>
  );
}
