// The sidebar, grouped as in docs/design/admin.html. No page is added or
// removed — the existing routes are sorted into the mockup's three groups.
export type NavItem = { href: string; label: string };
export type NavGroup = { label: string; items: NavItem[] };

export const NAV_GROUPS: NavGroup[] = [
  {
    label: 'Run the business',
    items: [
      { href: '/', label: 'Overview' },
      { href: '/merchants', label: 'Merchants' },
      { href: '/findings', label: 'Findings' },
      { href: '/reports', label: 'Reports' },
      { href: '/billing', label: 'Billing' },
    ],
  },
  {
    label: 'Keep it healthy',
    items: [
      { href: '/issues', label: 'Issues' },
      { href: '/support', label: 'Support' },
      { href: '/connections', label: 'Connections' },
      { href: '/reconciliation', label: 'Reconciliation' },
      { href: '/metrics', label: 'Metrics' },
    ],
  },
  {
    label: 'Setup',
    items: [{ href: '/settings', label: 'Settings' }],
  },
];

// Flat list retained for any consumer that just needs every destination.
export const NAV_ITEMS: NavItem[] = NAV_GROUPS.flatMap((g) => g.items);
