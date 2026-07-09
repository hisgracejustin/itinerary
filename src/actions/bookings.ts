"use server";

import { asc, eq, inArray } from "drizzle-orm";
import { db, tables } from "@/db";
import { requireUser, runAction } from "@/lib/action-utils";
import { accessibleTripIds, requireTripAccess, WRITE_ROLES } from "@/lib/authz";
import { bookingInsertSchema, bookingUpdateSchema, tripInsertSchema } from "@/lib/schemas";

export async function getBookingsAction(tripId?: string | null) {
  return runAction(async () => {
    const user = await requireUser();
    if (tripId) {
      await requireTripAccess(user.id, tripId);
      return db
        .select()
        .from(tables.bookings)
        .where(eq(tables.bookings.trip_id, tripId))
        .orderBy(asc(tables.bookings.start_date));
    }
    const ids = await accessibleTripIds(user.id);
    if (ids.length === 0) return [];
    return db
      .select()
      .from(tables.bookings)
      .where(inArray(tables.bookings.trip_id, ids))
      .orderBy(asc(tables.bookings.start_date));
  });
}

export async function getBookingAction(id: string) {
  return runAction(async () => {
    const user = await requireUser();
    const [booking] = await db
      .select()
      .from(tables.bookings)
      .where(eq(tables.bookings.id, id))
      .limit(1);
    if (!booking) throw new Error("Booking not found");
    await requireTripAccess(user.id, booking.trip_id);
    return booking;
  });
}

export async function createBookingAction(input: unknown) {
  return runAction(async () => {
    const user = await requireUser();
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
    return row;
  });
}

export async function updateBookingAction(id: string, input: unknown) {
  return runAction(async () => {
    const user = await requireUser();
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
    return row;
  });
}

export async function deleteBookingAction(id: string) {
  return runAction(async () => {
    const user = await requireUser();
    const [existing] = await db
      .select({ trip_id: tables.bookings.trip_id })
      .from(tables.bookings)
      .where(eq(tables.bookings.id, id))
      .limit(1);
    if (!existing) return { id };
    await requireTripAccess(user.id, existing.trip_id, WRITE_ROLES);
    await db.delete(tables.bookings).where(eq(tables.bookings.id, id));
    return { id };
  });
}

export async function getTripsAction() {
  return runAction(async () => {
    const user = await requireUser();
    const ids = await accessibleTripIds(user.id);
    if (ids.length === 0) return [];
    return db
      .select({
        id: tables.trips.id,
        name: tables.trips.name,
        start_date: tables.trips.start_date,
        end_date: tables.trips.end_date,
      })
      .from(tables.trips)
      .where(inArray(tables.trips.id, ids))
      .orderBy(asc(tables.trips.start_date));
  });
}

export async function getTripMetaAction(tripId?: string | null) {
  return runAction(async () => {
    const user = await requireUser();
    if (!tripId) return null;
    const ids = await accessibleTripIds(user.id);
    if (!ids.includes(tripId)) return null;
    const [trip] = await db
      .select()
      .from(tables.trips)
      .where(eq(tables.trips.id, tripId))
      .limit(1);
    return trip ?? null;
  });
}

export async function createTripAction(input: unknown) {
  return runAction(async () => {
    const user = await requireUser();
    const data = tripInsertSchema.parse(input);
    const [trip] = await db
      .insert(tables.trips)
      .values({ name: data.name, start_date: data.start_date, end_date: data.end_date })
      .returning();
    // Auto-assign the creator as owner (replaces the old supabase.auth.getUser() step).
    await db.insert(tables.tripMembers).values({
      trip_id: trip.id,
      user_id: user.id,
      role: "owner",
    });
    return trip;
  });
}
