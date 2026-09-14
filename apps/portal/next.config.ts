import type { NextConfig } from 'next';
import { loadRootEnv } from '@grossline/core';

// One .env at the repo root; Next only auto-loads app-local files.
loadRootEnv();

const nextConfig: NextConfig = {
  transpilePackages: ['@grossline/core', '@grossline/db'],
};

export default nextConfig;
