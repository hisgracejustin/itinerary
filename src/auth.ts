import NextAuth from "next-auth";
import Google from "next-auth/providers/google";
import Credentials from "next-auth/providers/credentials";
import { DrizzleAdapter } from "@auth/drizzle-adapter";
import { eq } from "drizzle-orm";
import { db, dbReady, tables } from "@/db";
import { authConfig } from "@/auth.config";

const allowedEmails = () =>
  (process.env.ALLOWED_EMAILS ?? "")
    .split(",")
    .map((e) => e.trim().toLowerCase())
    .filter(Boolean);

function isAllowed(email: string | null | undefined): boolean {
  if (!email) return false;
  const list = allowedEmails();
  // Fail closed in production if the allowlist is unset; open in local dev.
  if (list.length === 0) return process.env.NODE_ENV !== "production";
  return list.includes(email.toLowerCase());
}

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
      // Link a returning user's Google login to their migrated `users` row by
      // email (the row we seeded with their old Supabase UUID). Safe here because
      // access is gated by the ALLOWED_EMAILS allowlist below.
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
                if (!email || !isAllowed(email)) return null;
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
    callbacks: {
      ...authConfig.callbacks,
      async signIn({ user }) {
        // Allowlist gate — the core access control (replaces Supabase's private
        // provisioning). Authorization to specific trips is enforced per-action
        // via trip_members (see src/lib/authz.ts).
        if (!isAllowed(user.email)) return false;
        return true;
      },
    },
  };
});
