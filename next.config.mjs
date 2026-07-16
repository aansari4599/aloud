/** @type {import('next').NextConfig} */
const nextConfig = {
  experimental: {
    // Native/server-only packages must not be bundled by webpack.
    serverComponentsExternalPackages: ['better-sqlite3', 'playwright', 'jsdom'],
  },
};

export default nextConfig;
