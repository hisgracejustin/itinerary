"use server";

import { eq } from "drizzle-orm";
import { z } from "zod";
import { revalidatePath } from "next/cache";
import { db, tables } from "@/db";
import { runAction } from "@/lib/action-utils";
import { requireTripAccess, WRITE_ROLES } from "@/lib/authz";
import {
  bookingInsertSchema,
  bookingUpdateSchema,
  tripInsertSchema,
  tripUpdateSchema,
} from "@/lib/schemas";

// Reads are done server-side in RSC pages via @/lib/queries; these actions are
// the write path. Each revalidates the app layout so every screen re-renders
// from fresh server props.
const revalidateApp = () => revalidatePath("/", "layout");

export async function createBookingAction(input: unknown) {
  return runAction(async (user) => {
    const data = bookingInsertSchema.parse(input);
    await requireTripAccess(user.id, data.trip_id, WRITE_ROLES);
    const [row] = await db
      .insert(tables.bookings)
      .values({
        id: data.id || crypto.randomUUID(),
        trip_id: data.trip_id,
        type: data.type,
        title: data.title,
        start_date: data.start_date,
        end_date: data.end_date ?? null,
        confirmation_number: data.confirmation_number ?? null,
        provider: data.provider ?? null,
        details: data.details ?? null,
        cost_amount: data.cost_amount ?? null,
        cost_currency: data.cost_currency ?? null,
        cost_share: data.cost_share ?? null,
        source: data.source ?? "manual",
        source_file: data.source_file ?? null,
        raw_text: data.raw_text ?? null,
      })
      .returning();
    revalidateApp();
    return row;
  });
}

export async function updateBookingAction(id: string, input: unknown) {
  return runAction(async (user) => {
    const updates = bookingUpdateSchema.parse(input);
    const [existing] = await db
      .select({ trip_id: tables.bookings.trip_id })
      .from(tables.bookings)
      .where(eq(tables.bookings.id, id))
      .limit(1);
    if (!existing) throw new Error("Booking not found");
    await requireTripAccess(user.id, existing.trip_id, WRITE_ROLES);
    // If the booking is being reassigned to another trip, require write there too.
    if (updates.trip_id && updates.trip_id !== existing.trip_id) {
      await requireTripAccess(user.id, updates.trip_id, WRITE_ROLES);
    }
    const [row] = await db
      .update(tables.bookings)
      .set(updates)
      .where(eq(tables.bookings.id, id))
      .returning();
    revalidateApp();
    return row;
  });
}

export async function deleteBookingAction(id: string) {
  return runAction(async (user) => {
    const [existing] = await db
      .select({ trip_id: tables.bookings.trip_id })
      .from(tables.bookings)
      .where(eq(tables.bookings.id, id))
      .limit(1);
    if (!existing) return { id };
    await requireTripAccess(user.id, existing.trip_id, WRITE_ROLES);
    await db.delete(tables.bookings).where(eq(tables.bookings.id, id));
    revalidateApp();
    return { id };
  });
}

export async function createTripAction(input: unknown) {
  return runAction(async (user) => {
    const data = tripInsertSchema.parse(input);
    const [trip] = await db
      .insert(tables.trips)
      .values({ name: data.name, start_date: data.start_date, end_date: data.end_date })
      .returning();
    // Auto-assign the creator as owner.
    await db.insert(tables.tripMembers).values({
      trip_id: trip.id,
      user_id: user.id,
      role: "owner",
    });
    revalidateApp();
    return trip;
  });
}

export async function updateTripAction(id: unknown, input: unknown) {
  return runAction(async (user) => {
    const tripId = z.string().uuid().parse(id);
    const data = tripUpdateSchema.parse(input);
    await requireTripAccess(user.id, tripId, WRITE_ROLES);
    const [trip] = await db
      .update(tables.trips)
      .set(data)
      .where(eq(tables.trips.id, tripId))
      .returning();
    revalidateApp();
    return trip;
  });
}

/**
 * Deleting a trip cascades to its bookings/attachments and nulls the trip_id on
 * todos/day notes/reminders (see the schema's FK actions), so it's owner-only.
 */
export async function deleteTripAction(id: unknown) {
  return runAction(async (user) => {
    const tripId = z.string().uuid().parse(id);
    await requireTripAccess(user.id, tripId, ["owner"]);
    await db.delete(tables.trips).where(eq(tables.trips.id, tripId));
    revalidateApp();
    return { id: tripId };
  });
}
