import NextAuth from "next-auth";
import Google from "next-auth/providers/google";
import Credentials from "next-auth/providers/credentials";
import { DrizzleAdapter } from "@auth/drizzle-adapter";
import { eq } from "drizzle-orm";
import { db, dbReady, tables } from "@/db";
import { authConfig } from "@/auth.config";

/** Dev-only password-less login, active only when Google creds are absent. */
const devLoginEnabled = process.env.NODE_ENV !== "production" && !process.env.AUTH_GOOGLE_ID;

export const { handlers, auth, signIn, signOut } = NextAuth(async () => {
  await dbReady();
  return {
    ...authConfig,
    adapter: DrizzleAdapter(db, {
      usersTable: tables.users,
      accountsTable: tables.authAccounts,
      sessionsTable: tables.sessions,
      verificationTokensTable: tables.verificationTokens,
    }),
    providers: [
      // Link a Google login to an existing `users` row by email — this is how a
      // placeholder member (added to a trip by email) claims their account on
      // first sign-in. Safe with open signup because Google only asserts emails
      // it has verified; any future provider must do the same.
      ...(process.env.AUTH_GOOGLE_ID
        ? [Google({ allowDangerousEmailAccountLinking: true })]
        : []),
      ...(devLoginEnabled
        ? [
            Credentials({
              id: "dev",
              name: "Dev login",
              credentials: { email: { label: "Email" } },
              async authorize(credentials) {
                const email = String(credentials?.email ?? "").toLowerCase();
                if (!email) return null;
                const existing = await db.query.users.findFirst({
                  where: eq(tables.users.email, email),
                });
                if (existing) return existing;
                const [user] = await db
                  .insert(tables.users)
                  .values({ email, name: email.split("@")[0] })
                  .returning();
                return user;
              },
            }),
          ]
        : []),
    ],
    // Open signup: anyone who can sign in gets an (empty) account. Access to
    // actual data stays gated per-trip via trip_members (see src/lib/authz.ts).
    callbacks: authConfig.callbacks,
  };
});
