import { redirect } from 'next/navigation';
import { getPortalSession } from '../../lib/session';
import { login } from './actions';

export const dynamic = 'force-dynamic';

export default async function LoginPage({
  searchParams,
}: {
  searchParams: Promise<{ error?: string }>;
}) {
  if (await getPortalSession()) redirect('/');
  const { error } = await searchParams;

  return (
    <main className="mx-auto flex min-h-screen max-w-sm flex-col justify-center p-8">
      <div className="gl-panel" style={{ padding: 28 }}>
        <h1 className="gl-h1">Grossline</h1>
        <p className="gl-sub mt-1.5">Sign in to your reports.</p>
        {error ? (
          <p className="gl-error mt-3" style={{ marginBottom: 0 }}>
            Sign-in failed. Check your email and password, then try again.
          </p>
        ) : null}
        <form action={login} className="mt-4 flex flex-col gap-3">
          <label className="flex flex-col gap-1 text-meta">
            Email
            <input
              name="email"
              type="email"
              required
              autoComplete="username"
              className="gl-input"
            />
          </label>
          <label className="flex flex-col gap-1 text-meta">
            Password
            <input
              name="password"
              type="password"
              required
              autoComplete="current-password"
              className="gl-input"
            />
          </label>
          <button type="submit" className="gl-btn mt-1">
            Sign in
          </button>
        </form>
      </div>
      <p className="gl-sub mt-3 text-center">
        Access is by invitation. To get started, request your free first report at{' '}
        <a className="gl-link" href="https://getgrossline.com">
          getgrossline.com
        </a>
        .
      </p>
    </main>
  );
}
