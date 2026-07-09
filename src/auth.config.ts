import type { NextAuthConfig } from "next-auth";

/**
 * Edge-safe slice of the auth config — used by middleware (proxy.ts). No adapter,
 * no db imports; the JWT session cookie is verified with AUTH_SECRET alone.
 */
export const authConfig = {
  pages: { signIn: "/login", error: "/login" },
  session: { strategy: "jwt" },
  callbacks: {
    authorized({ auth }) {
      return !!auth?.user;
    },
    session({ session, token }) {
      if (token.sub && session.user) session.user.id = token.sub;
      return session;
    },
  },
  providers: [], // real providers live in src/auth.ts
} satisfies NextAuthConfig;
