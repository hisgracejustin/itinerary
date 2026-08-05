"use server";

import { and, eq, ne } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { after } from "next/server";
import { db, tables, transaction } from "@/db";
import { runAction } from "@/lib/action-utils";
import { requireTripAccess, WRITE_ROLES } from "@/lib/authz";
import { AppError } from "@/lib/errors";
import {
  optionSetInsertSchema,
  optionSetUpdateSchema,
} from "@/lib/schemas";

// Defer revalidation so the Server Action promise can resolve. Awaiting
// revalidatePath("/", "layout") was hanging the client (modal stuck / photo
// uploads never started even though the row already appeared in the list).
const revalidateApp = () => {
  after(() => {
    revalidatePath("/", "layout");
  });
};

async function tripIdForSet(setId: string) {
  const [row] = await db
    .select({ trip_id: tables.optionSets.trip_id })
    .from(tables.optionSets)
    .where(eq(tables.optionSets.id, setId))
    .limit(1);
  return row;
}

async function tripIdForOption(optionId: string) {
  const [row] = await db
    .select({
      trip_id: tables.optionSets.trip_id,
      option_set_id: tables.options.option_set_id,
    })
    .from(tables.options)
    .innerJoin(tables.optionSets, eq(tables.options.option_set_id, tables.optionSets.id))
    .where(eq(tables.options.id, optionId))
    .limit(1);
  return row;
}

export async function createOptionSetAction(input: unknown) {
  return runAction(async (user) => {
    const data = optionSetInsertSchema.parse(input);
    await requireTripAccess(user.id, data.trip_id, WRITE_ROLES);
    const [row] = await db
      .insert(tables.optionSets)
      .values({
        id: data.id || crypto.randomUUID(),
        trip_id: data.trip_id,
        title: data.title,
        start_date: data.start_date ?? null,
        end_date: data.end_date ?? null,
        type: data.type,
        status: data.status ?? "open",
        notes: data.notes ?? null,
        created_by: user.id,
      })
      .returning();
    revalidateApp();
    return row;
  });
}

export async function updateOptionSetAction(id: string, input: unknown) {
  return runAction(async (user) => {
    const updates = optionSetUpdateSchema.parse(input);
    const existing = await tripIdForSet(id);
    if (!existing) throw new AppError("Decision not found");
    await requireTripAccess(user.id, existing.trip_id, WRITE_ROLES);
    if (updates.trip_id && updates.trip_id !== existing.trip_id) {
      await requireTripAccess(user.id, updates.trip_id, WRITE_ROLES);
    }
    const [row] = await db
      .update(tables.optionSets)
      .set({
        ...(updates.trip_id !== undefined ? { trip_id: updates.trip_id } : {}),
        ...(updates.title !== undefined ? { title: updates.title } : {}),
        ...(updates.start_date !== undefined ? { start_date: updates.start_date ?? null } : {}),
        ...(updates.end_date !== undefined ? { end_date: updates.end_date ?? null } : {}),
        ...(updates.type !== undefined ? { type: updates.type } : {}),
        ...(updates.status !== undefined ? { status: updates.status } : {}),
        ...(updates.notes !== undefined ? { notes: updates.notes ?? null } : {}),
      })
      .where(eq(tables.optionSets.id, id))
      .returning();
    revalidateApp();
    return row;
  });
}

export async function deleteOptionSetAction(id: string) {
  return runAction(async (user) => {
    const existing = await tripIdForSet(id);
    if (!existing) return { id };
    await requireTripAccess(user.id, existing.trip_id, WRITE_ROLES);
    await db.delete(tables.optionSets).where(eq(tables.optionSets.id, id));
    revalidateApp();
    return { id };
  });
}

export async function deleteOptionAction(id: string) {
  return runAction(async (user) => {
    const existing = await tripIdForOption(id);
    if (!existing) return { id };
    await requireTripAccess(user.id, existing.trip_id, WRITE_ROLES);
    await db.delete(tables.options).where(eq(tables.options.id, id));
    revalidateApp();
    return { id };
  });
}

/** Mark one option as the pick; clear siblings; set the decision to decided. */
export async function markOptionPickAction(optionId: string) {
  return runAction(async (user) => {
    const existing = await tripIdForOption(optionId);
    if (!existing) throw new AppError("Option not found");
    await requireTripAccess(user.id, existing.trip_id, WRITE_ROLES);

    await transaction(async (tx) => {
      await tx
        .update(tables.options)
        .set({ is_pick: false })
        .where(
          and(
            eq(tables.options.option_set_id, existing.option_set_id),
            ne(tables.options.id, optionId),
          ),
        );
      await tx
        .update(tables.options)
        .set({ is_pick: true })
        .where(eq(tables.options.id, optionId));
      await tx
        .update(tables.optionSets)
        .set({ status: "decided" })
        .where(eq(tables.optionSets.id, existing.option_set_id));
    });
    revalidateApp();
    return { id: optionId };
  });
}

/** Clear the pick on an option; reopen the decision if it was decided. */
export async function unpickOptionAction(optionId: string) {
  return runAction(async (user) => {
    const existing = await tripIdForOption(optionId);
    if (!existing) throw new AppError("Option not found");
    await requireTripAccess(user.id, existing.trip_id, WRITE_ROLES);

    await transaction(async (tx) => {
      await tx
        .update(tables.options)
        .set({ is_pick: false })
        .where(eq(tables.options.id, optionId));
      // Only reopen when we were decided — leave "dropped" alone.
      await tx
        .update(tables.optionSets)
        .set({ status: "open" })
        .where(
          and(
            eq(tables.optionSets.id, existing.option_set_id),
            eq(tables.optionSets.status, "decided"),
          ),
        );
    });
    revalidateApp();
    return { id: optionId };
  });
}

/** After converting an option into a booking, store the link. */
export async function linkOptionBookingAction(optionId: string, bookingId: string) {
  return runAction(async (user) => {
    const existing = await tripIdForOption(optionId);
    if (!existing) throw new AppError("Option not found");
    await requireTripAccess(user.id, existing.trip_id, WRITE_ROLES);
    const [booking] = await db
      .select({ trip_id: tables.bookings.trip_id })
      .from(tables.bookings)
      .where(eq(tables.bookings.id, bookingId))
      .limit(1);
    if (!booking) throw new AppError("Booking not found");
    if (booking.trip_id !== existing.trip_id) {
      throw new AppError("Booking and option must belong to the same trip");
    }

    const row = await transaction(async (tx) => {
      // Clear siblings before setting this row so the partial unique index is
      // satisfied throughout the transaction.
      await tx
        .update(tables.options)
        .set({ is_pick: false })
        .where(
          and(
            eq(tables.options.option_set_id, existing.option_set_id),
            ne(tables.options.id, optionId),
          ),
        );
      const [linked] = await tx
        .update(tables.options)
        .set({ converted_booking_id: bookingId, is_pick: true })
        .where(eq(tables.options.id, optionId))
        .returning();
      await tx
        .update(tables.optionSets)
        .set({ status: "decided" })
        .where(eq(tables.optionSets.id, existing.option_set_id));
      return linked;
    });
    revalidateApp();
    return row;
  });
}
