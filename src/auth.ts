import NextAuth from "next-auth";
import Google from "next-auth/providers/google";
import Credentials from "next-auth/providers/credentials";
import { DrizzleAdapter } from "@auth/drizzle-adapter";
import { eq } from "drizzle-orm";
import { db, dbReady, tables } from "@/db";
import { authConfig } from "@/auth.config";
import { verifyPin } from "@/lib/pin";

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
      // Email + PIN login for members without a Google account. The PIN is set
      // by a trip owner (Settings) and stored as an scrypt hash on `users`.
      // 5 straight failures lock the account for 15 minutes (PINs are short).
      Credentials({
        id: "pin",
        name: "Email + PIN",
        credentials: {
          email: { label: "Email" },
          pin: { label: "PIN", type: "password" },
        },
        async authorize(credentials) {
          const email = String(credentials?.email ?? "").trim().toLowerCase();
          const pin = String(credentials?.pin ?? "");
          if (!email || !pin) return null;
          const user = await db.query.users.findFirst({
            where: eq(tables.users.email, email),
          });
          if (!user?.password_hash) return null;
          const now = new Date();
          if (user.pin_locked_until && user.pin_locked_until > now) return null;
          if (!verifyPin(pin, user.password_hash)) {
            // A fail after an expired lock starts a fresh count instead of
            // instantly re-locking on the first typo.
            const lockExpired = !!user.pin_locked_until && user.pin_locked_until <= now;
            const attempts = lockExpired ? 1 : user.failed_pin_attempts + 1;
            await db
              .update(tables.users)
              .set({
                failed_pin_attempts: attempts,
                pin_locked_until: attempts >= 5 ? new Date(now.getTime() + 15 * 60 * 1000) : null,
              })
              .where(eq(tables.users.id, user.id));
            return null;
          }
          if (user.failed_pin_attempts > 0 || user.pin_locked_until) {
            await db
              .update(tables.users)
              .set({ failed_pin_attempts: 0, pin_locked_until: null })
              .where(eq(tables.users.id, user.id));
          }
          return user;
        },
      }),
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
