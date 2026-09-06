import type { NextConfig } from 'next';
import { loadRootEnv } from '@grossline/core';

// The repo keeps one .env at the root; Next only auto-loads app-local files.
loadRootEnv();

const nextConfig: NextConfig = {
  transpilePackages: ['@grossline/core', '@grossline/db', '@grossline/worker'],
  // Playwright is a native, server-only dependency (invoice PDF rendering) —
  // never bundle it or its dynamic requires; require it at runtime in the
  // route handler (imported directly from apps/admin/lib/pdf.ts, not through a
  // transpiled workspace package).
  serverExternalPackages: ['playwright', 'playwright-core', 'chromium-bidi'],
};

export default nextConfig;
