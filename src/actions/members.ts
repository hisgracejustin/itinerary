"use server";

import { and, eq, inArray, or } from "drizzle-orm";
import { z } from "zod";
import { revalidatePath } from "next/cache";
import { db, tables, transaction } from "@/db";
import { runAction } from "@/lib/action-utils";
import { requireAdmin, requireTripAccess, requireTripMembers } from "@/lib/authz";
import { partySchema } from "@/lib/schemas";
import { hashPin } from "@/lib/pin";

const revalidateApp = () => revalidatePath("/", "layout");

const OWNER_ONLY = ["owner"] as const;

const addMemberSchema = z.object({
  trip_id: z.string().uuid(),
  email: z.string().email().transform((e) => e.trim().toLowerCase()),
  role: z.enum(["owner", "editor", "viewer"]).default("editor"),
});

/**
 * Add someone to a trip by email so they can be assigned to-dos.
 *
 * If no account exists for that email yet we create the `users` row up front:
 * Auth.js links a Google sign-in to an existing row with the same email (the
 * provider sets allowDangerousEmailAccountLinking), so the placeholder becomes
 * their real account on first login.
 */
export async function addTripMemberAction(input: unknown) {
  return runAction(async (user) => {
    const data = addMemberSchema.parse(input);
    await requireTripAccess(user.id, data.trip_id, [...OWNER_ONLY]);

    const [found] = await db
      .select({ id: tables.users.id })
      .from(tables.users)
      .where(eq(tables.users.email, data.email))
      .limit(1);

    let targetId = found?.id;
    if (!targetId) {
      const [created] = await db
        .insert(tables.users)
        .values({ email: data.email, name: data.email.split("@")[0] })
        .returning();
      targetId = created.id;
    }

    const [already] = await db
      .select({ user_id: tables.tripMembers.user_id })
      .from(tables.tripMembers)
      .where(
        and(
          eq(tables.tripMembers.trip_id, data.trip_id),
          eq(tables.tripMembers.user_id, targetId),
        ),
      )
      .limit(1);
    if (already) throw new Error("They're already on this trip");

    await db
      .insert(tables.tripMembers)
      .values({ trip_id: data.trip_id, user_id: targetId, role: data.role });
    revalidateApp();
    return { id: targetId, email: data.email };
  });
}

const setRoleSchema = z.object({
  trip_id: z.string().uuid(),
  user_id: z.string().min(1),
  role: z.enum(["owner", "editor", "viewer"]),
});

/**
 * Change a member's role. A trip can have any number of owners — the only rule
 * is that it can't end up with zero, so demoting the last one is refused.
 */
export async function setTripMemberRoleAction(input: unknown) {
  return runAction(async (user) => {
    const data = setRoleSchema.parse(input);
    await requireTripAccess(user.id, data.trip_id, [...OWNER_ONLY]);

    const [target] = await db
      .select({ role: tables.tripMembers.role })
      .from(tables.tripMembers)
      .where(
        and(
          eq(tables.tripMembers.trip_id, data.trip_id),
          eq(tables.tripMembers.user_id, data.user_id),
        ),
      )
      .limit(1);
    if (!target) throw new Error("They're not on this trip");
    if (target.role === data.role) return { user_id: data.user_id, role: data.role };

    if (target.role === "owner" && data.role !== "owner") {
      const owners = await db
        .select({ user_id: tables.tripMembers.user_id })
        .from(tables.tripMembers)
        .where(
          and(eq(tables.tripMembers.trip_id, data.trip_id), eq(tables.tripMembers.role, "owner")),
        );
      if (owners.length <= 1) throw new Error("A trip needs at least one owner");
    }

    await db
      .update(tables.tripMembers)
      .set({ role: data.role })
      .where(
        and(
          eq(tables.tripMembers.trip_id, data.trip_id),
          eq(tables.tripMembers.user_id, data.user_id),
        ),
      );
    revalidateApp();
    return { user_id: data.user_id, role: data.role };
  });
}

const removeMemberSchema = z.object({
  trip_id: z.string().uuid(),
  user_id: z.string().min(1),
});

export async function removeTripMemberAction(input: unknown) {
  return runAction(async (user) => {
    const data = removeMemberSchema.parse(input);
    await requireTripAccess(user.id, data.trip_id, [...OWNER_ONLY]);

    const [target] = await db
      .select({ role: tables.tripMembers.role })
      .from(tables.tripMembers)
      .where(
        and(
          eq(tables.tripMembers.trip_id, data.trip_id),
          eq(tables.tripMembers.user_id, data.user_id),
        ),
      )
      .limit(1);
    if (!target) return { user_id: data.user_id };

    // Don't strip a trip of its last owner — it would become unmanageable.
    if (target.role === "owner") {
      const owners = await db
        .select({ user_id: tables.tripMembers.user_id })
        .from(tables.tripMembers)
        .where(
          and(
            eq(tables.tripMembers.trip_id, data.trip_id),
            eq(tables.tripMembers.role, "owner"),
          ),
        );
      if (owners.length <= 1) throw new Error("A trip needs at least one owner");
    }

    // H2: never silently rewrite balances. A member's split rows aren't "their
    // portion set aside" — a share is weight/Σweights of the amount, so deleting
    // them re-divides every shared cost among the people who STAY, retroactively,
    // and kept settlements would point at someone no longer here. So if the member
    // has any cost footprint on this trip (a split, a payer row, or a settlement),
    // refuse and make the owner resolve it first. Per-trip data access is revoked
    // the moment the membership row is gone, so no session bump is needed.
    const tripBookingIds = db
      .select({ id: tables.bookings.id })
      .from(tables.bookings)
      .where(eq(tables.bookings.trip_id, data.trip_id));
    const tripExpenseIds = db
      .select({ id: tables.expenses.id })
      .from(tables.expenses)
      .where(eq(tables.expenses.trip_id, data.trip_id));
    const [bSplit] = await db
      .select({ x: tables.bookingSplits.user_id })
      .from(tables.bookingSplits)
      .where(
        and(
          eq(tables.bookingSplits.user_id, data.user_id),
          inArray(tables.bookingSplits.booking_id, tripBookingIds),
        ),
      )
      .limit(1);
    const [eSplit] = await db
      .select({ x: tables.expenseSplits.user_id })
      .from(tables.expenseSplits)
      .where(
        and(
          eq(tables.expenseSplits.user_id, data.user_id),
          inArray(tables.expenseSplits.expense_id, tripExpenseIds),
        ),
      )
      .limit(1);
    const [bPaid] = await db
      .select({ id: tables.bookings.id })
      .from(tables.bookings)
      .where(
        and(eq(tables.bookings.trip_id, data.trip_id), eq(tables.bookings.paid_by, data.user_id)),
      )
      .limit(1);
    const [ePaid] = await db
      .select({ id: tables.expenses.id })
      .from(tables.expenses)
      .where(
        and(eq(tables.expenses.trip_id, data.trip_id), eq(tables.expenses.paid_by, data.user_id)),
      )
      .limit(1);
    const [settled] = await db
      .select({ id: tables.settlements.id })
      .from(tables.settlements)
      .where(
        and(
          eq(tables.settlements.trip_id, data.trip_id),
          or(
            eq(tables.settlements.from_user, data.user_id),
            eq(tables.settlements.to_user, data.user_id),
          ),
        ),
      )
      .limit(1);
    if (bSplit || eSplit || bPaid || ePaid || settled) {
      throw new Error(
        "This person still has shared costs or settlements on this trip. Remove or reassign their expenses and settlements first, then remove them.",
      );
    }

    await transaction(async (tx) => {
      await tx
        .delete(tables.tripMembers)
        .where(
          and(
            eq(tables.tripMembers.trip_id, data.trip_id),
            eq(tables.tripMembers.user_id, data.user_id),
          ),
        );
      // Their to-dos on this trip fall back to unassigned rather than staying
      // owned by someone who can no longer see the trip.
      await tx
        .update(tables.todos)
        .set({ assignee_id: null })
        .where(
          and(
            eq(tables.todos.trip_id, data.trip_id),
            eq(tables.todos.assignee_id, data.user_id),
          ),
        );
    });
    revalidateApp();
    return { user_id: data.user_id };
  });
}

const OWNER_ONLY_ARR = [...OWNER_ONLY];

/** Confirm a party belongs to the given trip (owner already verified). */
async function partyInTrip(tripId: string, partyId: string) {
  const [row] = await db
    .select({ id: tables.tripParties.id })
    .from(tables.tripParties)
    .where(and(eq(tables.tripParties.id, partyId), eq(tables.tripParties.trip_id, tripId)))
    .limit(1);
  if (!row) throw new Error("That party isn't on this trip");
}

/**
 * Create a settlement unit (couple/group) and assign it to `member_ids` in one
 * shot. A member belongs to at most one party, so this overwrites any prior
 * assignment for those members. Owner-only.
 */
export async function createPartyAction(input: unknown) {
  return runAction(async (user) => {
    const data = partySchema.parse(input);
    await requireTripAccess(user.id, data.trip_id, OWNER_ONLY_ARR);
    await requireTripMembers(data.trip_id, data.member_ids);

    const [party] = await db
      .insert(tables.tripParties)
      .values({ trip_id: data.trip_id, name: data.name })
      .returning();
    if (data.member_ids.length > 0) {
      await db
        .update(tables.tripMembers)
        .set({ party_id: party.id })
        .where(
          and(
            eq(tables.tripMembers.trip_id, data.trip_id),
            inArray(tables.tripMembers.user_id, data.member_ids),
          ),
        );
    }
    revalidateApp();
    return party;
  });
}

const renamePartySchema = z.object({
  trip_id: z.string().uuid(),
  party_id: z.string().uuid(),
  name: z.string().min(1),
});

export async function renamePartyAction(input: unknown) {
  return runAction(async (user) => {
    const data = renamePartySchema.parse(input);
    await requireTripAccess(user.id, data.trip_id, OWNER_ONLY_ARR);
    await partyInTrip(data.trip_id, data.party_id);
    await db
      .update(tables.tripParties)
      .set({ name: data.name })
      .where(eq(tables.tripParties.id, data.party_id));
    revalidateApp();
    return { party_id: data.party_id, name: data.name };
  });
}

const deletePartySchema = z.object({
  trip_id: z.string().uuid(),
  party_id: z.string().uuid(),
});

/** Delete a party; its members detach automatically via the FK's set-null. */
export async function deletePartyAction(input: unknown) {
  return runAction(async (user) => {
    const data = deletePartySchema.parse(input);
    await requireTripAccess(user.id, data.trip_id, OWNER_ONLY_ARR);
    await partyInTrip(data.trip_id, data.party_id);
    await db.delete(tables.tripParties).where(eq(tables.tripParties.id, data.party_id));
    revalidateApp();
    return { party_id: data.party_id };
  });
}

const updateMemberProfileSchema = z
  .object({
    trip_id: z.string().uuid(),
    user_id: z.string().min(1),
    name: z.string().min(1).optional(),
    email: z
      .string()
      .email()
      .transform((e) => e.trim().toLowerCase())
      .optional(),
  })
  .refine((d) => d.name !== undefined || d.email !== undefined, {
    message: "Provide a name or an email to change",
  });

/**
 * Zero rows anywhere that would make this `users` row worth keeping? Signup is
 * open, so a person can sign in with their NEW address before an admin moves it
 * onto their real row, leaving a hollow duplicate that then blocks the edit.
 * Such a row is safe to absorb only if nothing at all points at it — checked
 * across every table that references `users.id` with real content.
 */
async function userHasFootprint(userId: string) {
  const [member, bSplit, eSplit, bPaid, ePaid, settled, todo] = await Promise.all([
    db
      .select({ x: tables.tripMembers.user_id })
      .from(tables.tripMembers)
      .where(eq(tables.tripMembers.user_id, userId))
      .limit(1),
    db
      .select({ x: tables.bookingSplits.user_id })
      .from(tables.bookingSplits)
      .where(eq(tables.bookingSplits.user_id, userId))
      .limit(1),
    db
      .select({ x: tables.expenseSplits.user_id })
      .from(tables.expenseSplits)
      .where(eq(tables.expenseSplits.user_id, userId))
      .limit(1),
    db
      .select({ x: tables.bookings.id })
      .from(tables.bookings)
      .where(eq(tables.bookings.paid_by, userId))
      .limit(1),
    db
      .select({ x: tables.expenses.id })
      .from(tables.expenses)
      .where(eq(tables.expenses.paid_by, userId))
      .limit(1),
    db
      .select({ x: tables.settlements.id })
      .from(tables.settlements)
      .where(
        or(eq(tables.settlements.from_user, userId), eq(tables.settlements.to_user, userId)),
      )
      .limit(1),
    db
      .select({ x: tables.todos.id })
      .from(tables.todos)
      .where(eq(tables.todos.assignee_id, userId))
      .limit(1),
  ]);
  return !!(member[0] || bSplit[0] || eSplit[0] || bPaid[0] || ePaid[0] || settled[0] || todo[0]);
}

/**
 * Owner edits a member's display name and/or email. Changing the email unlinks
 * their existing login identities (the `accounts` rows) so the old Google login
 * can't reopen the account; on next sign-in Auth.js links the new address back
 * to the same `users` row by email (allowDangerousEmailAccountLinking).
 *
 * If the new address is already taken by an EMPTY `users` row (see
 * `userHasFootprint`) we absorb it rather than refusing: its login link moves to
 * the real person, so the sign-in they already did opens their actual account.
 * A row with any footprint is a genuine merge and still refuses loudly.
 */
export async function updateMemberProfileAction(input: unknown) {
  return runAction(async (user) => {
    const data = updateMemberProfileSchema.parse(input);
    // Admin-only: editing a person's email/identity must never be reachable via
    // trip ownership (which anyone can self-grant), or it becomes account takeover.
    requireAdmin(user);
    await requireTripMembers(data.trip_id, [data.user_id]);

    const [current] = await db
      .select({
        id: tables.users.id,
        name: tables.users.name,
        email: tables.users.email,
      })
      .from(tables.users)
      .where(eq(tables.users.id, data.user_id))
      .limit(1);
    if (!current) throw new Error("That person isn't a member of this trip");

    const updates: {
      name?: string;
      email?: string;
      emailVerified?: Date | null;
      password_hash?: null;
      failed_pin_attempts?: number;
      pin_locked_until?: null;
      sessions_valid_after?: Date;
    } = {};

    if (data.name !== undefined) updates.name = data.name;

    const emailChanged =
      data.email !== undefined && data.email !== (current.email ?? "").toLowerCase();
    // Id of an empty duplicate `users` row holding the new address, to absorb.
    let absorbId: string | null = null;
    if (emailChanged) {
      const [clash] = await db
        .select({ id: tables.users.id })
        .from(tables.users)
        .where(eq(tables.users.email, data.email!))
        .limit(1);
      if (clash && clash.id !== current.id) {
        if (await userHasFootprint(clash.id)) {
          throw new Error("That email already belongs to another person");
        }
        absorbId = clash.id;
      }
      updates.email = data.email;
      updates.emailVerified = null;
      // The PIN was issued to the previous identity — clear it with the email.
      updates.password_hash = null;
      updates.failed_pin_attempts = 0;
      updates.pin_locked_until = null;
      // Invalidate any live JWT session for the old holder (deleting accounts
      // rows only blocks future sign-ins; existing cookies stay valid ~30 days).
      updates.sessions_valid_after = new Date();
    }

    if (updates.name !== undefined || updates.email !== undefined) {
      // Order is load-bearing, all in one transaction:
      //  1. Delete the TARGET's old `accounts` rows first — the unlink. Doing it
      //     before the repoint is what stops it from wiping the absorbed link,
      //     and it also frees the (provider, provider_account_id) primary key in
      //     case both rows had linked the same provider.
      //  2. Repoint the squatter's `accounts` rows onto the target, so the
      //     sign-in they already completed opens their real account.
      //  3. Delete the hollow squatter row — only now, because `accounts` has
      //     on-delete-cascade and would otherwise take the link with it. This
      //     must also precede step 4, since it's still holding the new address
      //     against the unique index on `users.email`.
      //  4. Write name/email (+ PIN clear, session cutoff) onto the target.
      await transaction(async (tx) => {
        if (emailChanged) {
          // Drop the old login identities so the previous Google account can't
          // reopen this row; the new address re-links on next sign-in by email.
          await tx
            .delete(tables.authAccounts)
            .where(eq(tables.authAccounts.userId, current.id));
        }
        if (absorbId) {
          await tx
            .update(tables.authAccounts)
            .set({ userId: current.id })
            .where(eq(tables.authAccounts.userId, absorbId));
          await tx.delete(tables.users).where(eq(tables.users.id, absorbId));
        }
        await tx.update(tables.users).set(updates).where(eq(tables.users.id, current.id));
      });
    }

    revalidateApp();
    return {
      id: current.id,
      name: updates.name ?? current.name,
      email: updates.email ?? current.email,
    };
  });
}

const setMemberPinSchema = z.object({
  trip_id: z.string().uuid(),
  user_id: z.string().min(1),
  // null clears the PIN (revokes email+PIN login for this member).
  pin: z.string().min(6).max(64).nullable(),
});

/**
 * Owner sets/clears a member's login PIN (email + PIN sign-in for people
 * without a Google account). Stores only the hash; also resets any lockout.
 */
export async function setMemberPinAction(input: unknown) {
  return runAction(async (user) => {
    const data = setMemberPinSchema.parse(input);
    // Admin-only: writing another person's login credential is exactly the
    // takeover primitive, so trip ownership must not grant it.
    requireAdmin(user);
    await requireTripMembers(data.trip_id, [data.user_id]);
    await db
      .update(tables.users)
      .set({
        password_hash: data.pin === null ? null : hashPin(data.pin),
        failed_pin_attempts: 0,
        pin_locked_until: null,
        // Any PIN change (set or clear) invalidates the old holder's sessions.
        sessions_valid_after: new Date(),
      })
      .where(eq(tables.users.id, data.user_id));
    revalidateApp();
    return { user_id: data.user_id, has_pin: data.pin !== null };
  });
}

const setMyAvatarSchema = z.object({
  // One of the bundled frog icons in public/icons, or null to fall back to
  // initials. The regex is the whole trust boundary — never a free-form path.
  icon: z
    .string()
    .regex(/^icon([1-9]|1[0-6])\.png$/, "Unknown avatar")
    .nullable(),
});

/**
 * Self-service: the signed-in user picks their own avatar. No trip authz —
 * `runAction`'s user IS the target row. Clearing (null) also drops a
 * Google-provided photo, so the initials bubble shows everywhere.
 */
export async function setMyAvatarAction(input: unknown) {
  return runAction(async (user) => {
    const data = setMyAvatarSchema.parse(input);
    const image = data.icon === null ? null : `/icons/${data.icon}`;
    await db.update(tables.users).set({ image }).where(eq(tables.users.id, user.id));
    revalidateApp();
    return { image };
  });
}

const setMemberAvatarSchema = setMyAvatarSchema.extend({
  trip_id: z.string().uuid(),
  user_id: z.string().min(1),
});

/**
 * Owner sets a member's avatar — same trust boundary as the icon regex above,
 * gated like the other person-level edits (owner of a trip the person is on).
 */
export async function setMemberAvatarAction(input: unknown) {
  return runAction(async (user) => {
    const data = setMemberAvatarSchema.parse(input);
    // Admin-only: writes another person's `users.image` (global, all trips).
    requireAdmin(user);
    await requireTripMembers(data.trip_id, [data.user_id]);
    const image = data.icon === null ? null : `/icons/${data.icon}`;
    await db.update(tables.users).set({ image }).where(eq(tables.users.id, data.user_id));
    revalidateApp();
    return { user_id: data.user_id, image };
  });
}

const setMemberPartySchema = z.object({
  trip_id: z.string().uuid(),
  user_id: z.string().min(1),
  party_id: z.string().uuid().nullable(),
});

/**
 * Assign one member to a party (or `null` to remove them from theirs). A member
 * belongs to at most one party, so this overwrites. Owner-only.
 */
export async function setMemberPartyAction(input: unknown) {
  return runAction(async (user) => {
    const data = setMemberPartySchema.parse(input);
    await requireTripAccess(user.id, data.trip_id, OWNER_ONLY_ARR);
    await requireTripMembers(data.trip_id, [data.user_id]);
    if (data.party_id) await partyInTrip(data.trip_id, data.party_id);
    await db
      .update(tables.tripMembers)
      .set({ party_id: data.party_id })
      .where(
        and(
          eq(tables.tripMembers.trip_id, data.trip_id),
          eq(tables.tripMembers.user_id, data.user_id),
        ),
      );
    revalidateApp();
    return { user_id: data.user_id, party_id: data.party_id };
  });
}
