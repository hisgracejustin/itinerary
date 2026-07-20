"use server";

import { and, eq } from "drizzle-orm";
import { z } from "zod";
import { revalidatePath } from "next/cache";
import { db, tables } from "@/db";
import { runAction } from "@/lib/action-utils";
import { requireTripAccess } from "@/lib/authz";

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
 * their real account on first login. Note they must also be on the app's
 * ALLOWED_EMAILS allowlist to sign in at all — that's deployment config, not
 * something this action can grant.
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
    revalidateApp();
    return { user_id: data.user_id };
  });
}
