import { requestReset } from './actions';

export const dynamic = 'force-dynamic';

export default async function ResetRequestPage({
  searchParams,
}: {
  searchParams: Promise<{ sent?: string }>;
}) {
  const { sent } = await searchParams;
  return (
    <main className="mx-auto flex min-h-screen max-w-sm flex-col justify-center p-8">
      <div className="gl-panel" style={{ padding: 28 }}>
        <h1 className="gl-h1">Reset your password</h1>
        {sent ? (
          <p className="gl-sub mt-1.5">
            If that email belongs to an account, we&rsquo;ve sent a reset link. It is valid for one
            hour. Check your inbox.
          </p>
        ) : (
          <>
            <p className="gl-sub mt-1.5">
              Enter your email and we&rsquo;ll send you a link to set a new password.
            </p>
            <form action={requestReset} className="mt-4 flex flex-col gap-3">
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
              <button type="submit" className="gl-btn mt-1">
                Send reset link
              </button>
            </form>
          </>
        )}
        <p className="gl-sub mt-3">
          <a className="gl-link" href="/login">
            Back to sign in
          </a>
        </p>
      </div>
    </main>
  );
}
