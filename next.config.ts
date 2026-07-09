import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Self-hosted Docker (Coolify): emit a minimal traced server + node_modules at
  // .next/standalone so the runtime image can skip a full `npm install`.
  output: "standalone",

  // Native / wasm packages that must be loaded by Node directly, not bundled:
  //  - PGlite (local-dev embedded Postgres) ships wasm assets.
  //  - pg (node-postgres) is the production driver.
  serverExternalPackages: ["@electric-sql/pglite", "pg"],

  ...(process.env.NODE_ENV !== "production" && {
    experimental: {
      serverActions: {
        // Dev-only: devcontainer / port-forward proxies rewrite the Origin, so
        // Server Actions otherwise fail CSRF with "Invalid Server Actions request".
        allowedOrigins: [
          "localhost:3000",
          "127.0.0.1:3000",
          "*.devtunnels.ms",
          "*.app.github.dev",
        ],
      },
    },
  }),
};

export default nextConfig;
