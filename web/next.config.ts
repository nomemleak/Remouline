import type { NextConfig } from 'next';

const securityHeaders = [
  { key: 'X-Frame-Options', value: 'DENY' },
  { key: 'X-Content-Type-Options', value: 'nosniff' },
  { key: 'Referrer-Policy', value: 'no-referrer' },
  { key: 'Permissions-Policy', value: 'camera=(), microphone=(), geolocation=()' },
  { key: 'X-Robots-Tag', value: 'noindex, nofollow' },
  { key: 'Strict-Transport-Security', value: 'max-age=63072000; includeSubDomains' },
];

const nextConfig: NextConfig = {
  // `npm run dev:mock` builds into its own folder so it can run next to a normal `npm run dev`.
  distDir: process.env.NEXT_DIST_DIR || '.next',
  // Self-contained server for the Docker image (web/Dockerfile).
  output: 'standalone',
  poweredByHeader: false,
  experimental: {
    // Testsuite bundles are uploaded through the admin proxy.
    serverActions: { bodySizeLimit: '4mb' },
  },
  async headers() {
    return [{ source: '/:path*', headers: securityHeaders }];
  },
};

export default nextConfig;
