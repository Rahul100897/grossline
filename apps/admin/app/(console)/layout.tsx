import type { ReactNode } from 'react';
import { Shell } from '../../components/chrome';
import { logout } from '../login/actions';

export default function ConsoleLayout({ children }: { children: ReactNode }) {
  return (
    <Shell
      signOut={
        <form action={logout}>
          <button type="submit" className="text-[12px] text-slate hover:text-ink">
            Sign out
          </button>
        </form>
      }
    >
      {children}
    </Shell>
  );
}
