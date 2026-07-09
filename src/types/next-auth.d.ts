import type { DefaultSession } from "next-auth";

// The session callback (auth.config.ts) copies token.sub → session.user.id, so
// id is always present on an authenticated session.
declare module "next-auth" {
  interface Session {
    user: { id: string } & DefaultSession["user"];
  }
}
