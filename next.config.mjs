/** @type {import('next').NextConfig} */
const nextConfig = {
  experimental: {
    // Native/server-only packages must not be bundled by webpack.
    // axe-core: bundling mangles the source @axe-core/playwright injects into pages.
    serverComponentsExternalPackages: [
      'better-sqlite3',
      'playwright',
      'playwright-core',
      'jsdom',
      '@axe-core/playwright',
      'axe-core',
      'openai',
      'octokit',
    ],
  },
};

export default nextConfig;
