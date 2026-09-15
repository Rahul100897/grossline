import type { NextConfig } from 'next';
import { loadRootEnv } from '@grossline/core';

loadRootEnv();

const nextConfig: NextConfig = {
  transpilePackages: ['@grossline/core', '@grossline/db', '@grossline/worker'],
  serverExternalPackages: ['playwright', 'playwright-core', 'chromium-bidi'],
};

export default nextConfig;
