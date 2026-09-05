import { listTenants, type Tenant } from '@grossline/db';
import { requireSession } from '../lib/auth';
import { logout } from './login/actions';

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
    <main className="mx-auto max-w-3xl p-8">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-semibold">Tenants</h1>
        <form action={logout}>
          <button
            type="submit"
            className="rounded border border-neutral-300 px-3 py-1.5 text-sm hover:bg-neutral-100"
          >
            Sign out
          </button>
        </form>
      </div>

      {loadError ? (
        <p className="mt-6 rounded border border-red-200 bg-red-50 p-4 text-sm text-red-700">
          Could not load tenants. Is the database up? Check DATABASE_URL and try again.
        </p>
      ) : tenants && tenants.length === 0 ? (
        <p className="mt-6 rounded border border-neutral-200 bg-white p-4 text-sm text-neutral-500">
          No tenants yet. Create one with the onboarding script once Phase 1 lands, or insert via
          <code className="mx-1">createTenant</code> for now.
        </p>
      ) : (
        <table className="mt-6 w-full border-collapse text-sm">
          <thead>
            <tr className="border-b border-neutral-300 text-left text-neutral-500">
              <th className="py-2 pr-4 font-medium">Name</th>
              <th className="py-2 pr-4 font-medium">Slug</th>
              <th className="py-2 pr-4 font-medium">Status</th>
              <th className="py-2 pr-4 font-medium">Currency</th>
              <th className="py-2 pr-4 font-medium">Timezone</th>
              <th className="py-2 font-medium">Created</th>
            </tr>
          </thead>
          <tbody>
            {tenants!.map((t) => (
              <tr key={t.id} className="border-b border-neutral-100">
                <td className="py-2 pr-4">
                  {t.name}
                  {t.isDemo ? (
                    <span className="ml-2 rounded bg-amber-100 px-1.5 py-0.5 text-xs text-amber-800">
                      demo
                    </span>
                  ) : null}
                </td>
                <td className="py-2 pr-4 font-mono text-xs">{t.slug}</td>
                <td className="py-2 pr-4">{t.status}</td>
                <td className="py-2 pr-4">{t.reportingCurrency}</td>
                <td className="py-2 pr-4">{t.reportingTimezone}</td>
                <td className="py-2">{t.createdAt.toISOString().slice(0, 10)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </main>
  );
}
