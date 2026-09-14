import { peekMerchantToken } from '@grossline/db';
import { acceptInvite } from './actions';

export const dynamic = 'force-dynamic';

export default async function AcceptPage({
  params,
  searchParams,
}: {
  params: Promise<{ token: string }>;
  searchParams: Promise<{ error?: string; expired?: string }>;
}) {
  const { token } = await params;
  const { error, expired } = await searchParams;
  const valid = await peekMerchantToken(token, 'invite');

  return (
    <main className="mx-auto flex min-h-screen max-w-sm flex-col justify-center p-8">
      <div className="gl-panel" style={{ padding: 28 }}>
        <h1 className="gl-h1">Set your password</h1>
        {!valid ? (
          <p className="gl-sub mt-1.5">
            This invitation link has expired or has already been used. Ask whoever invited you to
            send a new one.
          </p>
        ) : (
          <>
            <p className="gl-sub mt-1.5">Choose a password to finish setting up your account.</p>
            {error ? (
              <p className="gl-error mt-3" style={{ marginBottom: 0 }}>
                Passwords must match and be at least 10 characters.
              </p>
            ) : null}
            {expired ? (
              <p className="gl-error mt-3" style={{ marginBottom: 0 }}>
                That link is no longer valid. Ask for a fresh invitation.
              </p>
            ) : null}
            <form action={acceptInvite} className="mt-4 flex flex-col gap-3">
              <input type="hidden" name="token" value={token} />
              <label className="flex flex-col gap-1 text-meta">
                New password
                <input
                  name="password"
                  type="password"
                  required
                  minLength={10}
                  autoComplete="new-password"
                  className="gl-input"
                />
              </label>
              <label className="flex flex-col gap-1 text-meta">
                Confirm password
                <input
                  name="confirm"
                  type="password"
                  required
                  minLength={10}
                  autoComplete="new-password"
                  className="gl-input"
                />
              </label>
              <button type="submit" className="gl-btn mt-1">
                Set password and sign in
              </button>
            </form>
          </>
        )}
      </div>
    </main>
  );
}
