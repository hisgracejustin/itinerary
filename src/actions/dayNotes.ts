"use server";

import { and, asc, eq, inArray, isNull, or } from "drizzle-orm";
import { db, tables } from "@/db";
import { requireUser, runAction } from "@/lib/action-utils";
import { accessibleTripIds, requireTripAccess, WRITE_ROLES } from "@/lib/authz";
import { dayNoteUpsertSchema } from "@/lib/schemas";

export async function getDayNotesAction(tripId?: string | null) {
  return runAction(async () => {
    const user = await requireUser();
    if (tripId) {
      await requireTripAccess(user.id, tripId);
      return db
        .select()
        .from(tables.dayNotes)
        .where(eq(tables.dayNotes.trip_id, tripId))
        .orderBy(asc(tables.dayNotes.date));
    }
    const ids = await accessibleTripIds(user.id);
    const filter = ids.length
      ? or(isNull(tables.dayNotes.trip_id), inArray(tables.dayNotes.trip_id, ids))
      : isNull(tables.dayNotes.trip_id);
    return db
      .select()
      .from(tables.dayNotes)
      .where(filter)
      .orderBy(asc(tables.dayNotes.date));
  });
}

export async function upsertDayNoteAction(input: unknown) {
  return runAction(async () => {
    const user = await requireUser();
    const { date, title, trip_id } = dayNoteUpsertSchema.parse(input);
    if (trip_id) await requireTripAccess(user.id, trip_id, WRITE_ROLES);

    const match = trip_id
      ? and(eq(tables.dayNotes.date, date), eq(tables.dayNotes.trip_id, trip_id))
      : and(eq(tables.dayNotes.date, date), isNull(tables.dayNotes.trip_id));
    const [existing] = await db.select().from(tables.dayNotes).where(match).limit(1);

    // Empty title deletes the note.
    if (!title.trim()) {
      if (existing) await db.delete(tables.dayNotes).where(eq(tables.dayNotes.id, existing.id));
      return null;
    }

    if (existing) {
      const [row] = await db
        .update(tables.dayNotes)
        .set({ title: title.trim() })
        .where(eq(tables.dayNotes.id, existing.id))
        .returning();
      return row;
    }
    const [row] = await db
      .insert(tables.dayNotes)
      .values({
        id: crypto.randomUUID(),
        date,
        title: title.trim(),
        trip_id: trip_id ?? null,
      })
      .returning();
    return row;
  });
}

export async function deleteDayNoteAction(id: string) {
  return runAction(async () => {
    const user = await requireUser();
    const [existing] = await db
      .select({ trip_id: tables.dayNotes.trip_id })
      .from(tables.dayNotes)
      .where(eq(tables.dayNotes.id, id))
      .limit(1);
    if (!existing) return { id };
    if (existing.trip_id) await requireTripAccess(user.id, existing.trip_id, WRITE_ROLES);
    await db.delete(tables.dayNotes).where(eq(tables.dayNotes.id, id));
    return { id };
  });
}
