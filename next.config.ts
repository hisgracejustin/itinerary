import { execSync } from "node:child_process";
import type { NextConfig } from "next";

// Bake the git short sha into the client bundle at build time; fall back to an
// env-provided version (or "dev") when git isn't available (e.g. shallow-less
// deploy environments without a .git directory).
let appVersion: string;
try {
  appVersion = execSync("git rev-parse --short HEAD").toString().trim();
} catch {
  appVersion = process.env.NEXT_PUBLIC_APP_VERSION ?? "dev";
}

const isDev = process.env.NODE_ENV !== "production";

// Content-Security-Policy. Every directive below is the tightest value the app
// actually runs under — the ones that look loose are load-bearing:
//
//  - script-src 'unsafe-inline': the App Router injects inline bootstrap and
//    flight-payload scripts on every response. Tightening this means a nonce,
//    which means every page becomes dynamic — not worth it while the real
//    XSS surface is one `dangerouslySetInnerHTML`-free React tree.
//  - script-src 'unsafe-eval' (dev only): webpack's dev bundle and React Fast
//    Refresh eval their modules. The production bundle does not.
//  - style-src 'unsafe-inline': Next inlines critical CSS. `blob:` is for the
//    offline day sheet, which rewrites its <link> hrefs to blob: copies of the
//    cached stylesheets (src/lib/offline-sheet.js).
//  - img-src blob:/data: covers attachment previews and the upload preview,
//    both of which are object URLs; lh3.googleusercontent.com is where Google
//    sign-in puts `users.image` (rendered raw by <Avatar>).
//  - frame-src blob: is the in-sheet PDF viewer — an <iframe> pointed at an
//    object URL so the platform PDF renderer handles it.
//  - worker-src is the service worker and the self-hosted pdf.js worker;
//    `blob:` because pdf.js falls back to a blob worker when it can't load the
//    script directly.
//  - connect-src ws: (dev only) is the HMR socket.
const csp = [
  "default-src 'self'",
  "base-uri 'self'",
  "object-src 'none'",
  "frame-ancestors 'none'",
  "form-action 'self'",
  `script-src 'self' 'unsafe-inline'${isDev ? " 'unsafe-eval'" : ""}`,
  "style-src 'self' 'unsafe-inline' blob:",
  "img-src 'self' blob: data: https://lh3.googleusercontent.com",
  "font-src 'self' data:",
  `connect-src 'self'${isDev ? " ws:" : ""}`,
  "worker-src 'self' blob:",
  "frame-src 'self' blob:",
  "manifest-src 'self'",
].join("; ");

const nextConfig: NextConfig = {
  env: {
    NEXT_PUBLIC_APP_VERSION: appVersion,
  },
  // Clickjacking is the sharp edge here: authenticated pages carry one-click
  // destructive actions (delete trip, remove member, record settlement), so a
  // framed session is a real attack, not a theoretical one.
  async headers() {
    return [
      {
        source: "/:path*",
        headers: [
          { key: "X-Frame-Options", value: "DENY" },
          { key: "X-Content-Type-Options", value: "nosniff" },
          { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
          { key: "Permissions-Policy", value: "camera=(), microphone=(), geolocation=()" },
        ],
      },
      {
        // Everything except the attachment stream, which sets its own, stricter
        // policy in the route handler. A config header wins over one set on the
        // handler's Response, so matching that path here would silently replace
        // the sandbox with this far more permissive policy.
        source: "/((?!api/attachments/).*)",
        headers: [{ key: "Content-Security-Policy", value: csp }],
      },
    ];
  },
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
