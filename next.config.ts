import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Native / wasm packages that must be loaded by Node directly, not bundled:
  //  - PGlite (local-dev embedded Postgres) ships wasm assets.
  //  - pg (node-postgres) is the production driver.
  serverExternalPackages: ["@electric-sql/pglite", "pg"],
  // Serverless (Vercel): dbReady() reads drizzle/meta/_journal.json from the
  // filesystem at runtime; file tracing can't see fs reads, so include the
  // migrations folder in every function bundle explicitly.
  outputFileTracingIncludes: {
    "/*": ["./drizzle/**/*"],
  },

  experimental: {
    // No staleTimes here, deliberately: the Router Cache reuses a page payload
    // across navigations that differ only in search params, and trip selection
    // lives in ?trip=… — with a stale time set, changing the selection served
    // up to 30s-old data for the previous selection (bookings missing from the
    // calendar in prod). Trip switches must always refetch.

    ...(process.env.NODE_ENV !== "production" && {
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
    }),
  },
};

export default nextConfig;
