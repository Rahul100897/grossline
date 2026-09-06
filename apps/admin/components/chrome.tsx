'use client';

// App chrome: sidebar navigation, off-canvas below the `desk` breakpoint.
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useState, type ReactNode } from 'react';
import { NAV_ITEMS } from '../lib/nav';

function NavLinks({ onNavigate }: { onNavigate?: () => void }) {
  const pathname = usePathname();
  return (
    <>
      {NAV_ITEMS.map((item) => {
        const active =
          item.href === '/' ? pathname === '/' : pathname.startsWith(item.href);
        return (
          <Link
            key={item.href}
            href={item.href}
            onClick={onNavigate}
            className={`block px-4 py-[5px] ${
              active ? 'bg-navactive font-semibold text-ink' : 'text-slate hover:text-ink'
            }`}
          >
            {item.label}
          </Link>
        );
      })}
    </>
  );
}

export function Shell({ children, signOut }: { children: ReactNode; signOut: ReactNode }) {
  const [open, setOpen] = useState(false);
  return (
    <div className="flex min-h-screen">
      {/* Desktop sidebar */}
      <nav className="hidden w-44 flex-none border-r border-hairline py-3.5 desk:block">
        <div className="px-4 pb-3.5 font-semibold tracking-tight">Grossline</div>
        <NavLinks />
        <div className="mt-6 px-4">{signOut}</div>
      </nav>

      {/* Mobile top bar + off-canvas */}
      <div className="fixed inset-x-0 top-0 z-20 flex items-center gap-3 border-b border-hairline bg-paper px-3 py-2 desk:hidden">
        <button
          type="button"
          aria-label="Menu"
          onClick={() => setOpen(true)}
          className="rounded border border-hairline px-2 py-0.5 text-slate"
        >
          ☰
        </button>
        <span className="font-semibold tracking-tight">Grossline</span>
      </div>
      {open ? (
        <div className="fixed inset-0 z-30 desk:hidden">
          <div
            className="absolute inset-0 bg-ink/30"
            onClick={() => setOpen(false)}
            aria-hidden
          />
          <nav className="absolute inset-y-0 left-0 w-56 border-r border-hairline bg-paper py-3.5">
            <div className="flex items-center justify-between px-4 pb-3.5">
              <span className="font-semibold tracking-tight">Grossline</span>
              <button
                type="button"
                aria-label="Close menu"
                onClick={() => setOpen(false)}
                className="text-slate"
              >
                ✕
              </button>
            </div>
            <NavLinks onNavigate={() => setOpen(false)} />
            <div className="mt-6 px-4">{signOut}</div>
          </nav>
        </div>
      ) : null}

      <main className="min-w-0 flex-1 px-4 pb-10 pt-12 desk:px-6 desk:pt-4">{children}</main>
    </div>
  );
}
