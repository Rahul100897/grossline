import type { NextConfig } from 'next';

const nextConfig: NextConfig = {
  transpilePackages: ['@grossline/core', '@grossline/db'],
};

export default nextConfig;
