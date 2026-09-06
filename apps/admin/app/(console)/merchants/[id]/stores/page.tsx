import { listStores, type Store } from '@grossline/db';
import { requireSession } from '../../../../../lib/auth';
import {
  EmptyState,
  ErrorState,
  Panel,
  Table,
  Td,
  Th,
  Tr,
} from '../../../../../components/ui';

export const dynamic = 'force-dynamic';

export default async function MerchantStoresPage({ params }: { params: Promise<{ id: string }> }) {
  await requireSession();
  const { id } = await params;

  let stores: Store[] | null = null;
  let loadError = false;
  try {
    stores = await listStores(id);
  } catch {
    loadError = true;
  }

  if (loadError || !stores) {
    return <ErrorState>Could not load stores. Is the database up?</ErrorState>;
  }
  if (stores.length === 0) {
    return <EmptyState>No stores yet. Connecting a Shopify store creates one.</EmptyState>;
  }

  return (
    <Panel>
      <Table>
        <thead>
          <tr>
            <Th>shop domain</Th>
            <Th>currency</Th>
            <Th>timezone</Th>
            <Th>status</Th>
          </tr>
        </thead>
        <tbody>
          {stores.map((store) => (
            <Tr key={store.id}>
              <Td>{store.shopDomain}</Td>
              <Td>{store.storeCurrency}</Td>
              <Td quiet>{store.storeTimezone}</Td>
              <Td quiet>{store.status}</Td>
            </Tr>
          ))}
        </tbody>
      </Table>
    </Panel>
  );
}
