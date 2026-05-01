/** @type {import('next').NextConfig} */
const nextConfig = {
  // Standalone build → minimal node_modules + server.js for the runner stage.
  output: "standalone",
  reactStrictMode: true,

  // Disable the X-Powered-By header — saves a few bytes per response and
  // doesn't leak the framework version.
  poweredByHeader: false,

  // No source maps in production. They double the JS payload size and we
  // can't ship them to a closed local network anyway.
  productionBrowserSourceMaps: false,

  // Built-in Next.js gzip on responses served by `next start`. nginx in
  // front of us also gzips, but having both is fine — the browser
  // negotiates with whichever sends the encoded response first.
  compress: true,

  async headers() {
    return [
      {
        // The service worker must never be served from a stale cache —
        // browsers check it on every load to detect updates.
        source: "/sw.js",
        headers: [
          { key: "Cache-Control", value: "no-cache, no-store, must-revalidate" },
          { key: "Service-Worker-Allowed", value: "/" },
        ],
      },
    ];
  },
};

export default nextConfig;
