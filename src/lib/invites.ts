import { createHash, randomBytes } from "node:crypto";
import { and, eq, gt, inArray, isNull, ne } from "drizzle-orm";
import { db, tables, transaction, type Db } from "@/db";
import { isAdmin } from "@/lib/authz";
import { AppError } from "@/lib/errors";
import { isPlaceholderEmail } from "@/lib/placeholder-email";
import { userHasFootprint } from "@/lib/user-footprint";

// Invite links: how someone who hasn't signed in yet — often a member the trip
// owner added by name only — takes over their member account, with everything
// already recorded for them. The owner sends a one-time link; whoever opens it
// signs in with Google or chooses an email + PIN, and becomes that member.
//
// The rules that make it safe for an owner (not just an admin) to send one:
//  - only for an account nobody has ever signed in to (no Google link, no PIN),
//    so there is no one to take it over from;
//  - only by an owner of every trip that person is on, so an owner can't use a
//    member of someone else's trip to see that trip;
//  - the link's secret is 256 random bits, stored only as a SHA-256, works once
//    and for INVITE_DAYS, and making a new one voids the old.
// Server-only.

/** How long an invite link works. */
export const INVITE_DAYS = 7;
/** Carries an invite through the Google sign-in round trip (see src/auth.ts). */
export const INVITE_COOKIE = "itin_invite";

// 32 random bytes, base64url: 43 characters.
const TOKEN_RE = /^[A-Za-z0-9_-]{43}$/;
export const hashToken = (token: string) => createHash("sha256").update(token).digest("hex");

type Caller = { id: string; email?: string | null };

/**
 * What can go wrong redeeming a link, by code: the Google callback sends the
 * code back to the join page in the URL, and the page shows only these texts —
 * never text from the URL itself.
 */
export const INVITE_ERRORS = {
  invalid: "This link isn't valid",
  spent: "This link has expired or was already used",
  inUse: "Someone already signs in to this account",
  ownEmail: "Use your own email address",
  emailTaken: "That email already has an account here. Sign in with it, or use a different email.",
  googleTaken: "That Google account already has an account here. Sign in with it instead.",
  failed: "Something went wrong. Please try again.",
} as const;
export type InviteErrorCode = keyof typeof INVITE_ERRORS;
/** The code for an error thrown by redeemInvite ("failed" for anything unexpected). */
export const inviteErrorCode = (err: unknown): InviteErrorCode =>
  ((err instanceof AppError &&
    (Object.keys(INVITE_ERRORS) as InviteErrorCode[]).find((k) => INVITE_ERRORS[k] === err.message)) ||
    "failed");

/** Whether anyone can sign in to this account yet: a linked Google login or a PIN. */
async function hasLogin(userId: string, q: Db = db): Promise<boolean> {
  const [u] = await q
    .select({ pin: tables.users.password_hash })
    .from(tables.users)
    .where(eq(tables.users.id, userId))
    .limit(1);
  if (u?.pin) return true;
  const [link] = await q
    .select({ x: tables.authAccounts.userId })
    .from(tables.authAccounts)
    .where(eq(tables.authAccounts.userId, userId))
    .limit(1);
  return !!link;
}

/** Throws unless `caller` owns `tripId` (or is an admin) and `memberId` is on it. */
async function requireOwnerOfMembersTrip(caller: Caller, tripId: string, memberId: string) {
  if (!isAdmin(caller)) {
    const [mine] = await db
      .select({ role: tables.tripMembers.role })
      .from(tables.tripMembers)
      .where(and(eq(tables.tripMembers.trip_id, tripId), eq(tables.tripMembers.user_id, caller.id)))
      .limit(1);
    if (mine?.role !== "owner") throw new AppError("Only this trip's owners can do that");
  }
  const [onTrip] = await db
    .select({ x: tables.tripMembers.user_id })
    .from(tables.tripMembers)
    .where(and(eq(tables.tripMembers.trip_id, tripId), eq(tables.tripMembers.user_id, memberId)))
    .limit(1);
  if (!onTrip) throw new AppError("They're not on this trip");
}

/**
 * Throws unless `caller` may invite or rename `memberId` from `tripId`: an owner
 * of it (or an admin), the person has never signed in, and — for anyone but an
 * admin — every other trip they're on is one the caller owns too.
 */
export async function requireManageableMember(caller: Caller, tripId: string, memberId: string) {
  await requireOwnerOfMembersTrip(caller, tripId, memberId);
  if (await hasLogin(memberId)) throw new AppError("They already sign in themselves");
  if (isAdmin(caller)) return;
  const others = (
    await db
      .select({ trip_id: tables.tripMembers.trip_id })
      .from(tables.tripMembers)
      .where(and(eq(tables.tripMembers.user_id, memberId), ne(tables.tripMembers.trip_id, tripId)))
  ).map((r) => r.trip_id);
  if (!others.length) return;
  const owned = await db
    .select({ trip_id: tables.tripMembers.trip_id })
    .from(tables.tripMembers)
    .where(
      and(
        inArray(tables.tripMembers.trip_id, others),
        eq(tables.tripMembers.user_id, caller.id),
        eq(tables.tripMembers.role, "owner"),
      ),
    );
  if (owned.length < others.length) {
    throw new AppError("They're also on a trip you don't own, so only an admin can do this");
  }
}

/**
 * Whether whoever sent an invite could still send it: the member is still on
 * the trip it was sent from, and — unless the sender is an admin — every trip
 * they're on is still one the sender owns. Checked again whenever a link is
 * opened or used, because a link outlives the check made when it was created:
 * otherwise someone could keep a link until the member was added to another
 * owner's trip, then use it to see that trip.
 */
async function senderStillCovers(
  q: Db,
  invite: { user_id: string; trip_id: string; created_by: string | null },
): Promise<boolean> {
  if (!invite.created_by) return false;
  const [sender] = await q
    .select({ email: tables.users.email })
    .from(tables.users)
    .where(eq(tables.users.id, invite.created_by))
    .limit(1);
  if (!sender) return false;
  const trips = (
    await q
      .select({ trip_id: tables.tripMembers.trip_id })
      .from(tables.tripMembers)
      .where(eq(tables.tripMembers.user_id, invite.user_id))
  ).map((r) => r.trip_id);
  if (!trips.includes(invite.trip_id)) return false;
  if (isAdmin(sender)) return true;
  const owned = await q
    .select({ trip_id: tables.tripMembers.trip_id })
    .from(tables.tripMembers)
    .where(
      and(
        inArray(tables.tripMembers.trip_id, trips),
        eq(tables.tripMembers.user_id, invite.created_by),
        eq(tables.tripMembers.role, "owner"),
      ),
    );
  return owned.length === trips.length;
}

/** A fresh link for `memberId` (replacing any earlier one). The token is returned once and never stored. */
export async function createInvite(caller: Caller, tripId: string, memberId: string) {
  await requireManageableMember(caller, tripId, memberId);
  const token = randomBytes(32).toString("base64url");
  const expiresAt = new Date(Date.now() + INVITE_DAYS * 86_400_000);
  await transaction(async (tx) => {
    await tx.delete(tables.memberInvites).where(eq(tables.memberInvites.user_id, memberId));
    await tx.insert(tables.memberInvites).values({
      user_id: memberId,
      trip_id: tripId,
      token_hash: hashToken(token),
      created_by: caller.id,
      expires_at: expiresAt,
    });
  });
  return { token, expiresAt };
}

/** Voids `memberId`'s link, if any. */
export async function cancelInvite(caller: Caller, tripId: string, memberId: string) {
  await requireOwnerOfMembersTrip(caller, tripId, memberId);
  await db
    .delete(tables.memberInvites)
    .where(and(eq(tables.memberInvites.user_id, memberId), isNull(tables.memberInvites.used_at)));
}

export type InviteState = "ok" | "expired" | "used" | "invalid";
export type InviteView = {
  state: InviteState;
  tripName?: string;
  memberName?: string;
  inviterName?: string;
  expiresAt?: Date;
};

const nameOf = (u: { name: string | null; email: string } | undefined) =>
  u ? u.name || (isPlaceholderEmail(u.email) ? "Someone" : u.email.split("@")[0]) : undefined;

/** What the join page shows for a link. Only the holder of a valid link learns the trip and name. */
export async function inspectInvite(token: string): Promise<InviteView> {
  if (!TOKEN_RE.test(token)) return { state: "invalid" };
  const [row] = await db
    .select({
      user_id: tables.memberInvites.user_id,
      trip_id: tables.memberInvites.trip_id,
      created_by: tables.memberInvites.created_by,
      expires_at: tables.memberInvites.expires_at,
      used_at: tables.memberInvites.used_at,
      trip_name: tables.trips.name,
      member_name: tables.users.name,
      member_email: tables.users.email,
    })
    .from(tables.memberInvites)
    .innerJoin(tables.users, eq(tables.users.id, tables.memberInvites.user_id))
    .innerJoin(tables.trips, eq(tables.trips.id, tables.memberInvites.trip_id))
    .where(eq(tables.memberInvites.token_hash, hashToken(token)))
    .limit(1);
  if (!row) return { state: "invalid" };
  const [inviter] = row.created_by
    ? await db
        .select({ name: tables.users.name, email: tables.users.email })
        .from(tables.users)
        .where(eq(tables.users.id, row.created_by))
        .limit(1)
    : [];
  const view = {
    tripName: row.trip_name,
    memberName: nameOf({ name: row.member_name, email: row.member_email }),
    inviterName: nameOf(inviter),
    expiresAt: row.expires_at,
  };
  if (row.used_at || (await hasLogin(row.user_id))) return { state: "used", ...view };
  if (row.expires_at <= new Date()) return { state: "expired", ...view };
  if (!(await senderStillCovers(db, row))) return { state: "invalid" };
  return { state: "ok", ...view };
}

type Redemption = {
  /** The address they'll sign in with. */
  email: string;
  /** Proven theirs (Google said so), rather than typed in. */
  verified: boolean;
  /** Hash of the PIN they chose (the PIN path). */
  pinHash?: string;
  /** Their Google account (the Google path). */
  googleAccountId?: string;
};

/**
 * Hands the invited member account to whoever holds the link: sets the email
 * (and PIN, or marks it verified by Google) and marks the link used. All in one
 * transaction that starts by claiming the link, so two tabs racing one link
 * can't both win, and a refusal leaves the link usable for another try.
 */
export async function redeemInvite(token: string, r: Redemption): Promise<{ userId: string }> {
  if (!TOKEN_RE.test(token)) throw new AppError(INVITE_ERRORS.invalid);
  const email = r.email.trim().toLowerCase();
  if (!email || isPlaceholderEmail(email)) throw new AppError(INVITE_ERRORS.ownEmail);

  return transaction(async (tx) => {
    const [invite] = await tx
      .update(tables.memberInvites)
      .set({ used_at: new Date() })
      .where(
        and(
          eq(tables.memberInvites.token_hash, hashToken(token)),
          isNull(tables.memberInvites.used_at),
          gt(tables.memberInvites.expires_at, new Date()),
        ),
      )
      .returning();
    if (!invite) throw new AppError(INVITE_ERRORS.spent);
    if (!(await senderStillCovers(tx, invite))) throw new AppError(INVITE_ERRORS.invalid);
    const memberId = invite.user_id;
    if (await hasLogin(memberId, tx)) throw new AppError(INVITE_ERRORS.inUse);

    const [clash] = await tx
      .select({ id: tables.users.id })
      .from(tables.users)
      .where(and(eq(tables.users.email, email), ne(tables.users.id, memberId)))
      .limit(1);
    if (clash) {
      // An address Google vouched for may take over an empty leftover account
      // holding it (moving its sign-in across); a typed-in one never does.
      if (!r.verified || (await userHasFootprint(clash.id, tx))) {
        throw new AppError(INVITE_ERRORS.emailTaken);
      }
      await tx
        .update(tables.authAccounts)
        .set({ userId: memberId })
        .where(eq(tables.authAccounts.userId, clash.id));
      await tx.delete(tables.users).where(eq(tables.users.id, clash.id));
    }

    if (r.googleAccountId) {
      const [linked] = await tx
        .select({ userId: tables.authAccounts.userId })
        .from(tables.authAccounts)
        .where(
          and(
            eq(tables.authAccounts.provider, "google"),
            eq(tables.authAccounts.providerAccountId, r.googleAccountId),
          ),
        )
        .limit(1);
      if (linked && linked.userId !== memberId) {
        throw new AppError(INVITE_ERRORS.googleTaken);
      }
    }

    await tx
      .update(tables.users)
      .set({
        email,
        email_unverified: !r.verified,
        emailVerified: r.verified ? new Date() : null,
        ...(r.pinHash ? { password_hash: r.pinHash, failed_pin_attempts: 0, pin_locked_until: null } : {}),
      })
      .where(eq(tables.users.id, memberId));
    await tx
      .delete(tables.memberInvites)
      .where(and(eq(tables.memberInvites.user_id, memberId), isNull(tables.memberInvites.used_at)));
    return { userId: memberId };
  });
}

/**
 * Whether a Google sign-in (with no invite) may proceed for `email`. Google
 * links by email to an existing account, so an address someone typed in for a
 * PIN — never proven to be theirs, maybe a typo, maybe a stranger's — must not
 * let that address's real owner in. Only a Google account already linked to it
 * may sign in there.
 */
export async function googleMaySignIn(email: string, googleAccountId: string): Promise<boolean> {
  const [user] = await db
    .select({ id: tables.users.id, unverified: tables.users.email_unverified })
    .from(tables.users)
    .where(eq(tables.users.email, email.trim().toLowerCase()))
    .limit(1);
  if (!user) return false;
  if (!user.unverified) return true;
  const [linked] = await db
    .select({ x: tables.authAccounts.userId })
    .from(tables.authAccounts)
    .where(
      and(
        eq(tables.authAccounts.userId, user.id),
        eq(tables.authAccounts.provider, "google"),
        eq(tables.authAccounts.providerAccountId, googleAccountId),
      ),
    )
    .limit(1);
  return !!linked;
}
