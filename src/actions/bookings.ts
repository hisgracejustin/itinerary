"use server";

import { eq } from "drizzle-orm";
import { z } from "zod";
import { revalidatePath } from "next/cache";
import { db, tables } from "@/db";
import { runAction } from "@/lib/action-utils";
import { requireTripAccess, requireTripMembers, WRITE_ROLES } from "@/lib/authz";
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

/**
 * Replace-all split rows for a booking. `splits === undefined` leaves existing
 * rows untouched; `splits: []` un-splits; a non-empty set replaces wholesale.
 */
async function replaceBookingSplits(
  bookingId: string,
  splits: { user_id: string; weight: number }[] | undefined,
) {
  if (splits === undefined) return;
  await db.delete(tables.bookingSplits).where(eq(tables.bookingSplits.booking_id, bookingId));
  if (splits.length > 0) {
    await db.insert(tables.bookingSplits).values(
      splits.map((s) => ({ booking_id: bookingId, user_id: s.user_id, weight: s.weight })),
    );
  }
}

export async function createBookingAction(input: unknown) {
  return runAction(async (user) => {
    const data = bookingInsertSchema.parse(input);
    await requireTripAccess(user.id, data.trip_id, WRITE_ROLES);
    // The payer and every split participant must belong to the booking's trip.
    await requireTripMembers(data.trip_id, [
      data.paid_by,
      ...(data.splits ?? []).map((s) => s.user_id),
    ]);
    const id = data.id || crypto.randomUUID();
    const [row] = await db
      .insert(tables.bookings)
      .values({
        id,
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
        paid_by: data.paid_by ?? null,
        source: data.source ?? "manual",
        source_file: data.source_file ?? null,
        raw_text: data.raw_text ?? null,
      })
      .returning();
    await replaceBookingSplits(id, data.splits);
    revalidateApp();
    return row;
  });
}

export async function updateBookingAction(id: string, input: unknown) {
  return runAction(async (user) => {
    const parsed = bookingUpdateSchema.parse(input);
    // `splits` isn't a bookings column — pull it out of the DB update set.
    const { splits, ...updates } = parsed;
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
    // Validate payer + split participants against the booking's (possibly new)
    // trip — moving a booking must not carry over members who don't belong.
    const targetTripId = updates.trip_id ?? existing.trip_id;
    await requireTripMembers(targetTripId, [
      updates.paid_by,
      ...(splits ?? []).map((s) => s.user_id),
    ]);
    let row;
    if (Object.keys(updates).length > 0) {
      [row] = await db
        .update(tables.bookings)
        .set(updates)
        .where(eq(tables.bookings.id, id))
        .returning();
    } else {
      [row] = await db.select().from(tables.bookings).where(eq(tables.bookings.id, id)).limit(1);
    }
    await replaceBookingSplits(id, splits);
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
