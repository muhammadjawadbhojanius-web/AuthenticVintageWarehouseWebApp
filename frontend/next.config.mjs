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

  // Proxy /api/* to the backend. In Docker, nginx handles this; when running
  // directly on Windows (no Docker / no nginx), Next.js rewrites take over.
  async rewrites() {
    return [
      {
        source: "/api/:path*",
        destination: "http://localhost:8080/:path*",
      },
    ];
  },
};

export default nextConfig;
