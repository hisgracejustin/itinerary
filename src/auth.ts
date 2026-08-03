import NextAuth from "next-auth";
import Google from "next-auth/providers/google";
import Credentials from "next-auth/providers/credentials";
import { DrizzleAdapter } from "@auth/drizzle-adapter";
import { eq, sql } from "drizzle-orm";
import { db, dbReady, tables } from "@/db";
import { authConfig } from "@/auth.config";
import { isAdmin } from "@/lib/authz";
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
      // first sign-in. Safe because Google only asserts emails it has verified
      // AND the signIn callback below requires that row to already exist; any
      // future provider must satisfy both.
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
          if (!(await verifyPin(pin, user.password_hash))) {
            // Both columns are computed by the database from the row's own
            // current values, never from the `user` we read a moment ago: with
            // a JS read-modify-write, N guesses fired in parallel all read the
            // same base count and all write the same result, so the 5-try lock
            // never engages and brute force is a matter of concurrency. Count
            // and lock move in one statement so there is no instant in which
            // the count has reached the threshold but the lock is not yet set.
            //
            // A fail after an expired lock starts a fresh count instead of
            // instantly re-locking on the first typo. Postgres evaluates every
            // SET expression against the pre-update row, so both CASEs see the
            // old `pin_locked_until`.
            const nextAttempts = sql`case when ${tables.users.pin_locked_until} is not null and ${tables.users.pin_locked_until} <= now() then 1 else ${tables.users.failed_pin_attempts} + 1 end`;
            await db
              .update(tables.users)
              .set({
                failed_pin_attempts: nextAttempts,
                pin_locked_until: sql`case when (${nextAttempts}) >= 5 then now() + interval '15 minutes' else null end`,
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
    // Invite-only: sign-in requires an existing account, and access to data
    // stays gated per-trip via trip_members (see src/lib/authz.ts).
    callbacks: {
      ...authConfig.callbacks,
      // Google may only sign in an email that already has a `users` row (created
      // when a trip owner adds that person by email) or a configured admin —
      // the bootstrap case, where the first admin has no row yet. The pin
      // provider already requires an existing row with a hash; dev login is
      // dev-only. Without this, Google sign-in is open registration.
      async signIn({ user, account }) {
        if (account?.provider !== "google") return true;
        const email = user.email?.trim().toLowerCase();
        if (!email) return false;
        if (isAdmin({ email })) return true;
        const existing = await db.query.users.findFirst({
          where: eq(tables.users.email, email),
          columns: { id: true },
        });
        return !!existing;
      },
      // JWT session revocation (H6). Sessions are stateless, so an admin changing
      // a user's email/PIN can't otherwise reach their live cookie. Here we revoke
      // any token issued before the user's `sessions_valid_after` cutoff. On the
      // sign-in call `iat` isn't set yet (skipped); on later reads it is present.
      async jwt({ token }) {
        const sub = token.sub;
        const iat = typeof token.iat === "number" ? token.iat : null;
        if (sub && iat) {
          await dbReady();
          const row = await db.query.users.findFirst({
            where: eq(tables.users.id, sub),
            columns: { sessions_valid_after: true },
          });
          const cutoff = row?.sessions_valid_after;
          if (cutoff && cutoff.getTime() > iat * 1000) return null;
        }
        return token;
      },
    },
  };
});
