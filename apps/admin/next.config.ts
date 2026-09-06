import type { NextConfig } from 'next';
import { loadRootEnv } from '@grossline/core';

// The repo keeps one .env at the root; Next only auto-loads app-local files.
loadRootEnv();

const nextConfig: NextConfig = {
  transpilePackages: ['@grossline/core', '@grossline/db', '@grossline/worker'],
};

export default nextConfig;
