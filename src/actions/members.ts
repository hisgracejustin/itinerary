"use server";

import { and, eq, inArray } from "drizzle-orm";
import { z } from "zod";
import { revalidatePath } from "next/cache";
import { db, tables } from "@/db";
import { runAction } from "@/lib/action-utils";
import { requireTripAccess, requireTripMembers } from "@/lib/authz";
import { partySchema } from "@/lib/schemas";

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

    await db
      .delete(tables.tripMembers)
      .where(
        and(
          eq(tables.tripMembers.trip_id, data.trip_id),
          eq(tables.tripMembers.user_id, data.user_id),
        ),
      );
    // Their to-dos on this trip fall back to unassigned rather than staying
    // owned by someone who can no longer see the trip.
    await db
      .update(tables.todos)
      .set({ assignee_id: null })
      .where(
        and(
          eq(tables.todos.trip_id, data.trip_id),
          eq(tables.todos.assignee_id, data.user_id),
        ),
      );

    // Scrub their cost footprint on this trip: drop their split rows and null any
    // payer pointers at them. Settlement history stays. Acceptable data loss —
    // the balances no longer involve someone who left the trip.
    const tripBookingIds = db
      .select({ id: tables.bookings.id })
      .from(tables.bookings)
      .where(eq(tables.bookings.trip_id, data.trip_id));
    const tripExpenseIds = db
      .select({ id: tables.expenses.id })
      .from(tables.expenses)
      .where(eq(tables.expenses.trip_id, data.trip_id));
    await db
      .delete(tables.bookingSplits)
      .where(
        and(
          eq(tables.bookingSplits.user_id, data.user_id),
          inArray(tables.bookingSplits.booking_id, tripBookingIds),
        ),
      );
    await db
      .delete(tables.expenseSplits)
      .where(
        and(
          eq(tables.expenseSplits.user_id, data.user_id),
          inArray(tables.expenseSplits.expense_id, tripExpenseIds),
        ),
      );
    await db
      .update(tables.bookings)
      .set({ paid_by: null })
      .where(
        and(eq(tables.bookings.trip_id, data.trip_id), eq(tables.bookings.paid_by, data.user_id)),
      );
    await db
      .update(tables.expenses)
      .set({ paid_by: null })
      .where(
        and(eq(tables.expenses.trip_id, data.trip_id), eq(tables.expenses.paid_by, data.user_id)),
      );
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
