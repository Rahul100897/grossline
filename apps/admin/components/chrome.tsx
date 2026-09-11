'use client';

// App chrome: the dark-green sidebar + off-canvas drawer, ported from
// docs/design/admin.html (design port, Step D). All styling lives in the gl-*
// classes in app/primitives.css; this component only composes them.
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useState, type ReactNode } from 'react';
import { NAV_GROUPS } from '../lib/nav';

function Mark() {
  // Brand mark from the mockup. Fills use tokens (no hex in the SVG).
  return (
    <svg className="gl-mark" viewBox="0 0 64 64" xmlns="http://www.w3.org/2000/svg" aria-hidden>
      <rect width="64" height="64" rx="14" style={{ fill: 'var(--gl-green)' }} />
      <path
        d="M43 24.5a12 12 0 1 0 1.2 14.5H33v-6.4h18v2.4A19 19 0 1 1 47.7 20z"
        style={{ fill: 'var(--gl-white)' }}
      />
    </svg>
  );
}

function Nav({ onNavigate }: { onNavigate?: () => void }) {
  const pathname = usePathname();
  return (
    <>
      {NAV_GROUPS.map((group) => (
        <div className="gl-navgrp" key={group.label}>
          <div className="gl-lbl">{group.label}</div>
          {group.items.map((item) => {
            const active = item.href === '/' ? pathname === '/' : pathname.startsWith(item.href);
            return (
              <Link
                key={item.href}
                href={item.href}
                onClick={onNavigate}
                className={`gl-navitem${active ? ' on' : ''}`}
              >
                <span>{item.label}</span>
              </Link>
            );
          })}
        </div>
      ))}
    </>
  );
}

export function Shell({ children, signOut }: { children: ReactNode; signOut: ReactNode }) {
  const [open, setOpen] = useState(false);
  return (
    <div className="gl-shell">
      {/* Mobile: a floating toggle reveals the off-canvas sidebar (admin.html). */}
      <button type="button" className="gl-mobnav" aria-label="Menu" onClick={() => setOpen(true)}>
        ☰
      </button>
      <div className={`gl-scrim${open ? ' on' : ''}`} onClick={() => setOpen(false)} aria-hidden />

      <aside className={`gl-side${open ? ' open' : ''}`}>
        <div className="gl-logo">
          <Mark />
          Grossline
        </div>
        <Nav onNavigate={() => setOpen(false)} />
        <div className="gl-sidefoot">
          <b>Rahul</b>
          Admin · only user
          <div className="gl-signout">{signOut}</div>
        </div>
      </aside>

      <main className="gl-main">
        <div className="gl-pad">{children}</div>
      </main>
    </div>
  );
}
