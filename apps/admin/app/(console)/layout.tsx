import type { ReactNode } from 'react';
import { Shell } from '../../components/chrome';
import { SupportWidget } from '../../components/support-widget';
import { logout } from '../login/actions';

export default function ConsoleLayout({ children }: { children: ReactNode }) {
  return (
    <Shell
      signOut={
        <form action={logout}>
          <button type="submit">Sign out</button>
        </form>
      }
    >
      {children}
      <SupportWidget />
    </Shell>
  );
}
