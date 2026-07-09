import NextAuth from "next-auth";
import { authConfig } from "@/auth.config";

// Edge-safe auth gate: verifies the JWT session cookie only; providers and the
// DB adapter live in src/auth.ts. Unauthenticated requests redirect to /login.
const { auth } = NextAuth(authConfig);

export default auth;

export const config = {
  // Everything except: auth endpoints, the self-guarded parse-booking route
  // (large uploads shouldn't run through the gate), the login page, Next
  // internals, and static/public assets.
  matcher: [
    "/((?!api/auth|api/parse-booking|login|_next/static|_next/image|favicon.ico|icon.png|manifest.webmanifest|sw.js|pdf.worker.min.mjs).*)",
  ],
};
