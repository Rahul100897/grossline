'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';

/** Underline tab strip for the merchant detail page; active tab from the URL. */
export function TabNav({ items }: { items: { href: string; label: string; exact?: boolean }[] }) {
  const pathname = usePathname();
  return (
    <nav className="mb-4 flex gap-1 overflow-x-auto border-b border-hairline">
      {items.map((item) => {
        const active = item.exact ? pathname === item.href : pathname.startsWith(item.href);
        return (
          <Link
            key={item.href}
            href={item.href}
            className={`-mb-px whitespace-nowrap border-b-2 px-2.5 py-1.5 text-[13px] ${
              active
                ? 'border-ink font-medium text-ink'
                : 'border-transparent text-slate hover:text-ink'
            }`}
          >
            {item.label}
          </Link>
        );
      })}
    </nav>
  );
}
